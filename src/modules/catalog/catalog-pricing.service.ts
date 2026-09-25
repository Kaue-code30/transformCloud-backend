import { Injectable } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository';
import type { CatalogPriceResult } from './catalog.types';

@Injectable()
export class CatalogPricingService {
  constructor(private readonly catalog: CatalogRepository) {}

  async calculate(
    offeringId: string,
    usageQuantity: number,
  ): Promise<CatalogPriceResult | null> {
    if (!Number.isFinite(usageQuantity) || usageQuantity <= 0) return null;

    const offering = await this.catalog.getOfferingWithPrices(offeringId);
    if (!offering?.meters.length) return null;

    const now = new Date();
    const components = offering.meters.filter(({ meter }) =>
      meter.effectiveFrom <= now && (!meter.effectiveTo || meter.effectiveTo > now),
    );
    if (!components.length) return null;

    const currencies = new Set(components.map(({ meter }) => meter.currency));
    if (currencies.size !== 1) return null;

    let estimatedCost = 0;
    for (const component of components) {
      const componentUsage = usageQuantity * component.quantity.toNumber();
      const multiplier = component.meter.unitMultiplier.toNumber();
      if (multiplier <= 0 || !component.meter.tiers.length) return null;
      estimatedCost += calculateTieredCost(
        componentUsage / multiplier,
        component.meter.tiers.map((tier) => ({
          start: tier.startQuantity.toNumber(),
          end: tier.endQuantity?.toNumber() ?? null,
          price: tier.unitPrice.toNumber(),
        })),
      );
    }

    const effectiveFrom = components
      .map(({ meter }) => meter.effectiveFrom)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      unitPrice: Number((estimatedCost / usageQuantity).toFixed(10)),
      estimatedCost: Number(estimatedCost.toFixed(2)),
      unit: components.map(({ meter }) => meter.pricingUnit).join(' + '),
      currency: components[0].meter.currency,
      source: meterCatalogSource(components[0].meter.attributes) ??
        `Catálogo local versionado (${offering.provider}/${offering.nativeSkuName})`,
      effectiveFrom: effectiveFrom.toISOString(),
    };
  }
}

function meterCatalogSource(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = (value as Record<string, unknown>).catalogSource;
  return typeof source === 'string' && source ? source : null;
}

interface Tier {
  start: number;
  end: number | null;
  price: number;
}

function calculateTieredCost(usage: number, tiers: Tier[]): number {
  const ordered = [...tiers].sort((a, b) => a.start - b.start);
  let total = 0;

  for (let index = 0; index < ordered.length; index++) {
    const tier = ordered[index];
    const nextStart = ordered[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const end = tier.end ?? nextStart;
    const billable = Math.max(0, Math.min(usage, end) - tier.start);
    total += billable * tier.price;
    if (usage <= end) break;
  }

  return total;
}
