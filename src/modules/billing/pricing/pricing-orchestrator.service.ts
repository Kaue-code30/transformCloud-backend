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

    const [gcpEntry, azureEntry] = await Promise.all([
      mapping?.gcp
        ? this.gcp.getPrice(mapping.gcp, hours)
        : this.notAvailable('Sem mapeamento GCP'),
      mapping?.azure
        ? this.azure.getPrice(mapping.azure, hours)
        : this.notAvailable('Sem mapeamento Azure'),
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
      gcpConfidence: mapping?.gcp?.confidence ?? null,
      azureConfidence: mapping?.azure?.confidence ?? null,
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
      gcpStatus: this.resolveStatus(item.gcp, item.gcpConfidence),
      azureStatus: this.resolveStatus(item.azure, item.azureConfidence),
      ociStatus: 'no_api',
    }));

    const verifiedCost = classified
      .filter((c) => c.gcpStatus === 'verified' || c.azureStatus === 'verified')
      .reduce((sum, c) => sum + c.currentCost, 0);

    const verifiedServices = classified.filter(
      (c) => c.gcpStatus === 'verified' || c.azureStatus === 'verified',
    ).length;

    const partialServices = classified.filter(
      (c) =>
        (c.gcpStatus === 'partial' || c.azureStatus === 'partial') &&
        c.gcpStatus !== 'verified' &&
        c.azureStatus !== 'verified',
    ).length;

    const notFoundServices = classified.filter(
      (c) =>
        c.gcpStatus === 'not_found' &&
        c.azureStatus === 'not_found',
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

  private notAvailable(reason: string): PriceEntry {
    return { price: null, verified: false, reason };
  }

  // Extrai quantidade de horas a partir da string de quantidade do serviço
  private estimateHours(svc: TopService): number {
    const match = svc.quantity.match(/(\d+)\s*hora/i);
    if (match) return parseInt(match[1]);
    // Fallback: mês padrão de 730 horas
    return 730;
  }
}