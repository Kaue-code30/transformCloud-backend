import { AzureCatalogAdapter } from './azure-catalog.adapter';

describe('AzureCatalogAdapter', () => {
  it('normaliza preço de consumo da Retail Prices API', () => {
    const snapshot = new AzureCatalogAdapter().toSnapshot(
      [
        {
          currencyCode: 'USD',
          tierMinimumUnits: 0,
          retailPrice: 0.85,
          armRegionName: 'brazilsouth',
          location: 'BR South',
          effectiveStartDate: '2026-09-01T00:00:00Z',
          meterId: 'meter-d8ps-v5',
          meterName: 'D8ps v5',
          productId: 'product-vm-dpsv5-linux',
          skuId: 'product-vm-dpsv5-linux/sku-d8ps-v5',
          productName: 'Virtual Machines Dpsv5 Series Linux',
          skuName: 'D8ps v5',
          serviceName: 'Virtual Machines',
          serviceId: 'DZH313Z7MMC8',
          serviceFamily: 'Compute',
          unitOfMeasure: '1 Hour',
          type: 'Consumption',
          isPrimaryMeterRegion: true,
          armSkuName: 'Standard_D8ps_v5',
        },
      ],
      {
        service: 'Virtual Machines',
        region: 'brazilsouth',
        match: 'Standard_D8ps_v5',
        memoryGiB: 32,
        architecture: 'arm64',
      },
    );

    expect(snapshot.provider).toBe('AZURE');
    expect(snapshot.source).toBe('AZURE_RETAIL_PRICES_API');
    expect(snapshot.offerings[0]).toMatchObject({
      nativeSkuName: 'Standard_D8ps_v5',
      vcpu: 8,
      memoryGiB: 32,
      region: 'brazilsouth',
    });
    expect(snapshot.meters[0]).toMatchObject({
      pricingUnit: 'Hrs',
      unitMultiplier: 1,
      tiers: [{ startQuantity: 0, unitPrice: 0.85 }],
    });
    expect(snapshot.meters[0].attributes).toMatchObject({
      catalogSource: 'AZURE_RETAIL_PRICES_API',
    });
  });
});
