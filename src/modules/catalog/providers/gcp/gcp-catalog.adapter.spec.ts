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
});
