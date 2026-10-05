import { GcpCatalogAdapter } from './gcp-catalog.adapter';

describe('GcpCatalogAdapter', () => {
  it('normaliza SKU, unidade e tiers do Cloud Billing Catalog', () => {
    const snapshot = new GcpCatalogAdapter().toSnapshot(
      { name: 'services/test', serviceId: 'test', displayName: 'Cloud Functions' },
      [{
        name: 'services/test/skus/SKU1', skuId: 'SKU1',
        description: 'Cloud Functions GB-Second',
        serviceRegions: ['southamerica-east1'],
        category: { serviceDisplayName: 'Cloud Functions', resourceFamily: 'Compute', usageType: 'OnDemand' },
        pricingInfo: [{
          effectiveTime: '2026-09-01T00:00:00Z',
          pricingExpression: {
            usageUnit: 'GiBy.s', usageUnitDescription: 'gibibyte second',
            tieredRates: [
              { startUsageAmount: 0, unitPrice: { currencyCode: 'USD', units: '0', nanos: 18000 } },
              { startUsageAmount: 400000, unitPrice: { currencyCode: 'USD', units: '0', nanos: 15000 } },
            ],
          },
        }],
      }],
      { service: 'Cloud Functions', region: 'southamerica-east1' },
    );

    expect(snapshot.source).toBe('GCP_CLOUD_BILLING_CATALOG_API');
    expect(snapshot.services[0].resourceKind).toBe('SERVERLESS_FUNCTION');
    expect(snapshot.offerings[0].nativeProductId).toBe('SKU1');
    expect(snapshot.meters[0]).toMatchObject({
      pricingUnit: 'GiBy.s', currency: 'USD',
      tiers: [
        { startQuantity: 0, unitPrice: 0.000018 },
        { startQuantity: 400000, unitPrice: 0.000015 },
      ],
    });
  });

  it('compõe CPU e memória em uma oferta de máquina', () => {
    const service = {
      name: 'services/6F81-5844-456A',
      serviceId: '6F81-5844-456A',
      displayName: 'Compute Engine',
    };
    const makeSku = (skuId: string, description: string, usageUnit: string) => ({
      name: `services/6F81-5844-456A/skus/${skuId}`,
      skuId,
      description,
      serviceRegions: ['southamerica-east1'],
      category: {
        serviceDisplayName: 'Compute Engine',
        resourceFamily: 'Compute',
        resourceGroup: description.includes('Core') ? 'CPU' : 'RAM',
        usageType: 'OnDemand',
      },
      pricingInfo: [{
        effectiveTime: '2026-10-01T00:00:00Z',
        pricingExpression: {
          usageUnit,
          tieredRates: [{
            startUsageAmount: 0,
            unitPrice: {
              currencyCode: 'USD',
              units: '0',
              nanos: 10_000_000,
            },
          }],
        },
      }],
    });
    const adapter = new GcpCatalogAdapter();
    const skus = [
      makeSku('cpu-sku', 'T2A Instance Core', 'h'),
      makeSku('ram-sku', 'T2A Instance Ram', 'GiBy.h'),
    ];
    const snapshot = adapter.toSnapshot(
      service,
      skus,
      {
        service: 'Compute Engine',
        region: 'southamerica-east1',
        skuIds: ['cpu-sku', 'ram-sku'],
        offeringName: 't2a-standard-8',
        vcpu: 8,
        memoryGiB: 32,
        architecture: 'arm64',
      },
    );

    expect(snapshot.offerings).toHaveLength(1);
    expect(snapshot.meters).toHaveLength(2);
    expect(snapshot.offeringMeters.map((item) => item.quantity)).toEqual([
      8, 32,
    ]);
    expect(() =>
      adapter.toSnapshot(service, [skus[0]], {
        service: 'Compute Engine',
        region: 'southamerica-east1',
        skuIds: ['cpu-sku', 'ram-sku'],
        offeringName: 't2a-standard-8',
      }),
    ).toThrow('SKUs GCP solicitados');
  });
});
