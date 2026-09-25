import { AwsCatalogAdapter } from './aws-catalog.adapter';

describe('AwsCatalogAdapter', () => {
  it('normaliza produto e preço On-Demand do formato oficial da AWS', () => {
    const adapter = new AwsCatalogAdapter();
    const snapshot = adapter.toSnapshot({
      version: 'official-version',
      products: {
        SKU1: {
          sku: 'SKU1',
          productFamily: 'Compute Instance',
          attributes: {
            servicename: 'Amazon Elastic Compute Cloud',
            instanceType: 'm7g.2xlarge',
            instanceFamily: 'General purpose',
            operatingSystem: 'Linux',
            processorArchitecture: '64-bit ARM',
            vcpu: '8',
            memory: '32 GiB',
          },
        },
      },
      terms: {
        OnDemand: {
          SKU1: {
            TERM1: {
              effectiveDate: '2026-09-01T00:00:00Z',
              priceDimensions: {
                RATE1: {
                  rateCode: 'RATE1',
                  description: 'Linux instance hour',
                  beginRange: '0',
                  endRange: 'Inf',
                  unit: 'Hrs',
                  pricePerUnit: { USD: '1.2345000000' },
                },
              },
            },
          },
        },
      },
    }, {
      serviceCode: 'AmazonEC2',
      region: 'sa-east-1',
      match: 'm7g.2xlarge',
    });

    expect(snapshot.source).toBe('AWS_PRICE_LIST_BULK_API');
    expect(snapshot.services[0].resourceKind).toBe('COMPUTE_VM');
    expect(snapshot.offerings[0]).toMatchObject({
      nativeProductId: 'SKU1',
      nativeSkuName: 'm7g.2xlarge',
      vcpu: 8,
      memoryGiB: 32,
      architecture: 'arm64',
    });
    expect(snapshot.meters[0]).toMatchObject({
      nativeMeterId: 'RATE1',
      pricingUnit: 'Hrs',
      currency: 'USD',
      tiers: [{ startQuantity: 0, unitPrice: 1.2345 }],
    });
  });
});
