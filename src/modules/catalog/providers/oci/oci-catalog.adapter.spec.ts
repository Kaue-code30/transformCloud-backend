import { OciCatalogAdapter } from './oci-catalog.adapter';

describe('OciCatalogAdapter', () => {
  it('normaliza tiers e multiplicador da lista pública da OCI', () => {
    const snapshot = new OciCatalogAdapter().toSnapshot(
      [
        {
          partNumber: 'B90617',
          displayName: 'Oracle Functions - Execution Time',
          metricName: '10,000 GB Memory-Seconds',
          serviceCategory: 'Application Development - Serverless',
          currencyCodeLocalizations: [
            {
              currencyCode: 'USD',
              prices: [
                {
                  model: 'PAY_AS_YOU_GO',
                  value: 0,
                  rangeMin: 0,
                  rangeMax: 40,
                },
                {
                  model: 'PAY_AS_YOU_GO',
                  value: 0.1417,
                  rangeMin: 40,
                  rangeMax: 999999999,
                },
              ],
            },
          ],
        },
      ],
      {
        region: 'sa-saopaulo-1',
        match: 'Functions - Execution Time',
        effectiveFrom: '2026-10-05T00:00:00Z',
      },
    );

    expect(snapshot.provider).toBe('OCI');
    expect(snapshot.source).toBe('OCI_PUBLIC_PRICE_LIST_API');
    expect(snapshot.meters[0]).toMatchObject({
      pricingUnit: 'GB-Second',
      unitMultiplier: 10_000,
      tiers: [
        { startQuantity: 0, endQuantity: 40, unitPrice: 0 },
        {
          startQuantity: 40,
          endQuantity: 999999999,
          unitPrice: 0.1417,
        },
      ],
    });
  });

  it('compõe OCPU e memória em uma única oferta de compute', () => {
    const products = [
      {
        partNumber: 'B109529',
        displayName: 'Compute - Standard - A2 OCPU',
        metricName: 'OCPU Per Hour',
        serviceCategory: 'Compute - Virtual Machine',
        currencyCodeLocalizations: [
          {
            currencyCode: 'USD',
            prices: [{ model: 'PAY_AS_YOU_GO', value: 0.014 }],
          },
        ],
      },
      {
        partNumber: 'B109530',
        displayName: 'Compute - Standard - A2 Memory',
        metricName: 'Gigabytes Per Hour',
        serviceCategory: 'Compute - Virtual Machine',
        currencyCodeLocalizations: [
          {
            currencyCode: 'USD',
            prices: [{ model: 'PAY_AS_YOU_GO', value: 0.002 }],
          },
        ],
      },
    ];
    const snapshot = new OciCatalogAdapter().toSnapshot(products, {
      region: 'sa-saopaulo-1',
      partNumbers: ['B109529', 'B109530'],
      offeringName: 'VM.Standard.A2.Flex-8-32',
      vcpu: 8,
      ocpu: 8,
      memoryGiB: 32,
      architecture: 'arm64',
      effectiveFrom: '2026-10-05T00:00:00Z',
    });

    expect(snapshot.offerings).toHaveLength(1);
    expect(snapshot.meters).toHaveLength(2);
    expect(snapshot.offeringMeters.map((item) => item.quantity)).toEqual([
      8, 32,
    ]);
    expect(() =>
      new OciCatalogAdapter().toSnapshot([products[0]], {
        region: 'sa-saopaulo-1',
        partNumbers: ['B109529', 'B109530'],
      }),
    ).toThrow('Part numbers OCI solicitados');
  });
});
