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
      complete: true,
    });
  });

  it('remove franquias gratuitas por conta da comparação de preço público', async () => {
    const repository = {
      getOfferingWithPrices: jest.fn().mockResolvedValue({
        provider: 'OCI',
        nativeSkuName: 'VM.Standard.A1.Flex-8-32',
        attributes: {},
        meters: [
          componentWithTiers('Hrs', 8, [
            tier(0, 3000, 0),
            tier(3000, null, 0.01),
          ]),
          componentWithTiers('Hrs', 32, [
            tier(0, 18000, 0),
            tier(18000, null, 0.0015),
          ]),
        ],
      }),
    } as unknown as CatalogRepository;
    const service = new CatalogPricingService(repository);

    const result = await service.calculate('oci-a1-8-32', 720);

    expect(result).toMatchObject({
      unitPrice: 0.128,
      estimatedCost: 92.16,
      complete: true,
    });
  });

  it('marca como incompleta uma oferta sem todos os componentes de custo', async () => {
    const repository = {
      getOfferingWithPrices: jest.fn().mockResolvedValue({
        provider: 'OCI',
        nativeSkuName: 'PostgreSQL-2-16',
        attributes: {
          pricingCompleteness: 'PARTIAL',
          pricingLimitations: ['Armazenamento otimizado não incluído'],
        },
        meters: [component('Hrs', 1, 0.098)],
      }),
    } as unknown as CatalogRepository;
    const service = new CatalogPricingService(repository);

    const result = await service.calculate('oci-postgresql', 720);

    expect(result).toMatchObject({
      estimatedCost: 70.56,
      complete: false,
      limitations: ['Armazenamento otimizado não incluído'],
    });
  });
});

function component(pricingUnit: string, quantity: number, unitPrice: number) {
  return componentWithTiers(pricingUnit, quantity, [
    tier(0, null, unitPrice),
  ]);
}

function componentWithTiers(
  pricingUnit: string,
  quantity: number,
  tiers: ReturnType<typeof tier>[],
) {
  return {
    quantity: new Prisma.Decimal(quantity),
    meter: {
      pricingUnit,
      currency: 'USD',
      unitMultiplier: new Prisma.Decimal(1),
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      attributes: { catalogSource: 'TEST' },
      tiers,
    },
  };
}

function tier(start: number, end: number | null, price: number) {
  return {
    startQuantity: new Prisma.Decimal(start),
    endQuantity: end == null ? null : new Prisma.Decimal(end),
    unitPrice: new Prisma.Decimal(price),
  };
}
