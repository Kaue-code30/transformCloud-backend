import { Injectable } from '@nestjs/common';
import { CatalogPricingService } from '../../catalog/catalog-pricing.service';
import type {
  BillingLineItem,
  ClassifiedPrice,
  ClassificationResult,
  CloudProvider,
  Confidence,
  MappingMetadata,
  MappingResult,
  PriceEntry,
  ServiceMapping,
  TopService,
  VerificationStatus,
} from '../types/pipeline.types';

@Injectable()
export class PricingOrchestratorService {
  constructor(private readonly catalogPricing: CatalogPricingService) {}

  async fetchPrices(
    billing: {
      provider: CloudProvider;
      totalCost: number;
      currency: string;
      topServices: TopService[];
      lineItems?: BillingLineItem[];
    },
    mappings: MappingResult,
  ): Promise<ClassificationResult> {
    const results = await Promise.all(
      billing.topServices.map((service) => {
        const mapping = mappings.mappings.find(
          (item) => normalize(item.original) === normalize(service.name),
        );
        const lineItem = findLineItem(service, billing.lineItems ?? []);
        return this.fetchServicePrice(service, mapping ?? null, lineItem);
      }),
    );

    return this.classify(
      results,
      billing.totalCost,
      billing.provider,
      billing.currency,
    );
  }

  private async fetchServicePrice(
    service: TopService,
    mapping: ServiceMapping | null,
    lineItem?: BillingLineItem,
  ) {
    const usageQuantity = estimateUsageQuantity(service, lineItem);
    const [gcp, azure, aws, oci] = await Promise.all([
      this.priceForMapping(mapping?.gcp, usageQuantity, 'GCP'),
      this.priceForMapping(mapping?.azure, usageQuantity, 'Azure'),
      this.priceForMapping(mapping?.aws, usageQuantity, 'AWS'),
      this.priceForMapping(mapping?.oci, usageQuantity, 'OCI'),
    ]);

    return {
      service: service.name,
      currentCost: service.cost,
      gcp,
      azure,
      oci,
      aws,
      gcpConfidence: mapping?.gcp?.confidence ?? null,
      azureConfidence: mapping?.azure?.confidence ?? null,
      ociConfidence: mapping?.oci?.confidence ?? null,
      awsConfidence: mapping?.aws?.confidence ?? null,
    };
  }

  private async priceForMapping(
    mapping: (MappingMetadata & { confidence: Confidence }) | undefined,
    usageQuantity: number,
    provider: string,
  ): Promise<PriceEntry> {
    if (!mapping) return notAvailable(`Sem mapeamento determinístico para ${provider}`);
    const price = await this.catalogPricing.calculate(
      mapping.catalogOfferingId,
      usageQuantity,
    );
    if (!price) {
      return notAvailable(`Oferta ${mapping.catalogOfferingId} sem preço vigente no catálogo`);
    }
    return {
      price: price.unitPrice,
      unit: price.unit,
      currency: price.currency,
      estimatedMonthly: price.estimatedCost,
      source: price.source,
      effectiveFrom: price.effectiveFrom,
      catalogOfferingId: mapping.catalogOfferingId,
      verified: true,
    };
  }

  private classify(
    raw: Array<Awaited<ReturnType<typeof this.fetchServicePrice>>>,
    totalCost: number,
    sourceProvider: CloudProvider,
    billingCurrency: string,
  ): ClassificationResult {
    const classified: ClassifiedPrice[] = raw.map((item) => ({
      service: item.service,
      currentCost: item.currentCost,
      gcp: item.gcp,
      azure: item.azure,
      oci: item.oci,
      aws: item.aws,
      gcpStatus: this.resolveStatus(item.gcp, item.gcpConfidence, billingCurrency),
      azureStatus: this.resolveStatus(item.azure, item.azureConfidence, billingCurrency),
      ociStatus: this.resolveStatus(item.oci, item.ociConfidence, billingCurrency),
      awsStatus: this.resolveStatus(item.aws, item.awsConfidence, billingCurrency),
    }));

    const statusesForTargets = (item: ClassifiedPrice) =>
      targetProviders(sourceProvider).map((provider) => statusFor(item, provider));
    const isVerified = (item: ClassifiedPrice) =>
      statusesForTargets(item).includes('verified');

    const verifiedCost = classified
      .filter(isVerified)
      .reduce((sum, item) => sum + item.currentCost, 0);
    const verifiedServices = classified.filter(isVerified).length;
    const partialServices = classified.filter((item) => {
      const statuses = statusesForTargets(item);
      return statuses.includes('partial') && !statuses.includes('verified');
    }).length;
    const notFoundServices = classified.filter((item) =>
      statusesForTargets(item).every(
        (status) => status === 'not_found' || status === 'no_api',
      ),
    ).length;

    return {
      classified,
      meta: {
        analyzedServices: classified.length,
        verifiedServices,
        partialServices,
        notFoundServices,
        coveredCostPct:
          totalCost > 0
            ? Math.min(100, Math.round((verifiedCost / totalCost) * 100))
            : 0,
      },
    };
  }

  private resolveStatus(
    entry: PriceEntry,
    confidence: Confidence | null,
    billingCurrency: string,
  ): VerificationStatus {
    if (!entry.verified || entry.price === null) return 'not_found';
    if (entry.currency && entry.currency !== billingCurrency) return 'partial';
    if (confidence === 'high') return 'verified';
    if (confidence === 'medium' || confidence === 'low') return 'partial';
    return 'not_found';
  }
}

function estimateUsageQuantity(service: TopService, lineItem?: BillingLineItem): number {
  if (
    lineItem &&
    Number.isFinite(lineItem.quantity) &&
    lineItem.quantity > 0
  ) {
    return lineItem.quantity;
  }
  if (
    service.usageQuantity != null &&
    Number.isFinite(service.usageQuantity) &&
    service.usageQuantity > 0
  ) {
    return service.usageQuantity;
  }

  const match = String(service.quantity ?? '').match(
    /([\d.,]+)\s*(?:instance[- ]?)?(?:hrs?|hours?|horas?)?/i,
  );
  if (!match) return 730;
  return parseLocaleNumber(match[1]) ?? 730;
}

function parseLocaleNumber(value: string): number | null {
  const normalized = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value)
    ? value.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)
      ? value.replace(/,/g, '')
      : value.replace(',', '.');
  const result = Number(normalized);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function findLineItem(
  service: TopService,
  lineItems: BillingLineItem[],
): BillingLineItem | undefined {
  if (service.sourceLineItemKey) {
    const exact = lineItems.find((item) => item.sourceKey === service.sourceLineItemKey);
    if (exact) return exact;
  }
  const wanted = normalize(service.name);
  return lineItems.find((item) =>
    [item.serviceCode, item.serviceName].filter(Boolean).some((value) => {
      const candidate = normalize(value!);
      return candidate.includes(wanted) || wanted.includes(candidate);
    }),
  );
}

function targetProviders(source: CloudProvider): CloudProvider[] {
  return (['AWS', 'GCP', 'AZURE', 'OCI'] as CloudProvider[]).filter(
    (provider) => provider !== source,
  );
}

function statusFor(item: ClassifiedPrice, provider: CloudProvider): VerificationStatus {
  if (provider === 'AWS') return item.awsStatus;
  if (provider === 'GCP') return item.gcpStatus;
  if (provider === 'AZURE') return item.azureStatus;
  return item.ociStatus;
}

function notAvailable(reason: string): PriceEntry {
  return { price: null, verified: false, reason };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
