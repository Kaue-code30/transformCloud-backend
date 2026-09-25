import { Prisma } from '@prisma/client';
import { CatalogPricingService } from './catalog-pricing.service';
import type { CatalogRepository } from './catalog.repository';

describe('CatalogPricingService', () => {
  it('soma componentes de CPU e memória usando os tiers persistidos', async () => {
    const repository = {
      getOfferingWithPrices: jest.fn().mockResolvedValue({
        provider: 'GCP',
        nativeSkuName: 't2a-standard-8',
        meters: [
          component('vCPU hour', 8, 0.1),
          component('GiBy hour', 32, 0.01),
        ],
      }),
    } as unknown as CatalogRepository;
    const service = new CatalogPricingService(repository);

    const result = await service.calculate('gcp-t2a-standard-8', 730);

    expect(result).toMatchObject({
      unitPrice: 1.12,
      estimatedCost: 817.6,
      currency: 'USD',
    });
  });
});

function component(pricingUnit: string, quantity: number, unitPrice: number) {
  return {
    quantity: new Prisma.Decimal(quantity),
    meter: {
      pricingUnit,
      currency: 'USD',
      unitMultiplier: new Prisma.Decimal(1),
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      tiers: [
        {
          startQuantity: new Prisma.Decimal(0),
          endQuantity: null,
          unitPrice: new Prisma.Decimal(unitPrice),
        },
      ],
    },
  };
}
