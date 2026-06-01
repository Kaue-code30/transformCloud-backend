import { Injectable } from '@nestjs/common';
import { AzurePricingService } from './azure-pricing.service';
import { AwsPricingService, AwsPricingParams } from './aws-pricing.service';
import { GcpPricingService } from './gcp-pricing.service';
import {
  ParsedBilling,
  MappingResult,
  ServiceMapping,
  TopService,
  ClassificationResult,
  ClassifiedPrice,
  PriceEntry,
  VerificationStatus,
  Confidence,
  AwsMapping,
} from '../types/pipeline.types';

@Injectable()
export class PricingOrchestratorService {
  constructor(
    private readonly azure: AzurePricingService,
    private readonly aws: AwsPricingService,
    private readonly gcp: GcpPricingService,
  ) {}

  // ─── Etapa 3: busca paralela de preços ───────────────────────────────────────

  async fetchPrices(
    billing: ParsedBilling,
    mappings: MappingResult,
  ): Promise<ClassificationResult> {
    const results = await Promise.all(
      billing.topServices.map((svc) => {
        const mapping = mappings.mappings.find((m) =>
          m.original.toLowerCase().includes(svc.name.toLowerCase()),
        );
        return this.fetchServicePrice(svc, mapping ?? null);
      }),
    );

    return this.classify(results, billing.totalCost);
  }

  private async fetchServicePrice(
    svc: TopService,
    mapping: ServiceMapping | null,
  ) {
    const hours = this.estimateHours(svc);

    const [gcpEntry, azureEntry, awsEntry] = await Promise.all([
      mapping?.gcp
        ? this.gcp.getPrice(mapping.gcp, hours)
        : this.notAvailable('Sem mapeamento GCP'),
      mapping?.azure
        ? this.azure.getPrice(mapping.azure, hours)
        : this.notAvailable('Sem mapeamento Azure'),
      mapping?.aws
        ? this.aws.getPrice(this.toAwsParams(mapping.aws), hours)
        : this.notAvailable('Sem mapeamento AWS'),
    ]);

    // OCI não tem API pública — sempre retorna sem dados
    const ociEntry: PriceEntry = {
      price: null,
      verified: false,
      reason: 'API pública não disponível para OCI',
    };

    return {
      service: svc.name,
      currentCost: svc.cost,
      gcp: gcpEntry,
      azure: azureEntry,
      oci: ociEntry,
      aws: awsEntry,
      gcpConfidence: mapping?.gcp?.confidence ?? null,
      azureConfidence: mapping?.azure?.confidence ?? null,
      awsConfidence: mapping?.aws?.confidence ?? null,
    };
  }

  // ─── Etapa 4: classificação de confiança ─────────────────────────────────────

  private classify(
    raw: Array<ReturnType<typeof this.fetchServicePrice> extends Promise<infer T> ? T : never>,
    totalCost: number,
  ): ClassificationResult {
    const classified: ClassifiedPrice[] = raw.map((item) => ({
      service: item.service,
      currentCost: item.currentCost,
      gcp: item.gcp,
      azure: item.azure,
      oci: item.oci,
      aws: item.aws,
      gcpStatus: this.resolveStatus(item.gcp, item.gcpConfidence),
      azureStatus: this.resolveStatus(item.azure, item.azureConfidence),
      ociStatus: 'no_api' as VerificationStatus,
      awsStatus: this.resolveStatus(item.aws, item.awsConfidence),
    }));

    const isVerified = (c: ClassifiedPrice) =>
      c.gcpStatus === 'verified' || c.azureStatus === 'verified' || c.awsStatus === 'verified';

    const verifiedCost = classified
      .filter(isVerified)
      .reduce((sum, c) => sum + c.currentCost, 0);

    const verifiedServices = classified.filter(isVerified).length;

    const partialServices = classified.filter(
      (c) =>
        (c.gcpStatus === 'partial' || c.azureStatus === 'partial' || c.awsStatus === 'partial') &&
        !isVerified(c),
    ).length;

    const notFoundServices = classified.filter(
      (c) =>
        c.gcpStatus === 'not_found' &&
        c.azureStatus === 'not_found' &&
        c.awsStatus === 'not_found',
    ).length;

    return {
      classified,
      meta: {
        analyzedServices: classified.length,
        verifiedServices,
        partialServices,
        notFoundServices,
        coveredCostPct: totalCost > 0
          ? Math.round((verifiedCost / totalCost) * 100)
          : 0,
      },
    };
  }

  private resolveStatus(entry: PriceEntry, confidence: Confidence | null): VerificationStatus {
    if (!entry.verified || entry.price === null) return 'not_found';
    if (confidence === 'high') return 'verified';
    if (confidence === 'medium' || confidence === 'low') return 'partial';
    return 'verified';
  }

  private toAwsParams(m: AwsMapping): AwsPricingParams {
    return {
      service: m.service,
      region: m.region ?? 'us-east-1',
      instanceType: m.instanceType,
      operatingSystem: m.operatingSystem,
      databaseEngine: m.databaseEngine,
    };
  }

  private notAvailable(reason: string): PriceEntry {
    return { price: null, verified: false, reason };
  }

  private estimateHours(svc: TopService): number {
    const q = String(svc.quantity ?? '');
    const match = q.match(/(\d+)\s*hora/i);
    if (match) return parseInt(match[1]);
    return 730;
  }
}