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

  it('compõe capacidade e 10 VPUs no Block Volume Balanced', () => {
    const products = [
      {
        partNumber: 'B91961',
        displayName: 'Storage - Block Volume - Storage',
        metricName: 'Gigabyte Storage Capacity Per Month',
        serviceCategory: 'Storage - Block Volumes',
        currencyCodeLocalizations: [{
          currencyCode: 'USD',
          prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0255 }],
        }],
      },
      {
        partNumber: 'B91962',
        displayName: 'Storage - Block Volume - Performance Units',
        metricName: 'Performance Units Per Gigabyte Per Month',
        serviceCategory: 'Storage - Block Volumes',
        currencyCodeLocalizations: [{
          currencyCode: 'USD',
          prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0017 }],
        }],
      },
    ];

    const snapshot = new OciCatalogAdapter().toSnapshot(products, {
      region: 'sa-saopaulo-1',
      partNumbers: ['B91961', 'B91962'],
      resourceKind: 'BLOCK_STORAGE',
      offeringName: 'Block Volume Balanced (10 VPU/GB)',
      vpuPerGiB: 10,
      effectiveFrom: '2026-10-19T00:00:00Z',
    });

    expect(snapshot.offeringMeters.map((item) => item.quantity)).toEqual([
      1, 10,
    ]);
    expect(snapshot.meters.map((item) => item.pricingUnit)).toEqual([
      'GB-Mo', 'VPU-GB-Mo',
    ]);
    expect(snapshot.offerings[0].attributes).toMatchObject({ vpuPerGiB: 10 });
    expect(snapshot.offerings[0].attributes?.pricingCompleteness).toBeUndefined();
  });

  it('marca Block Volume sem VPUs como preço parcial', () => {
    const snapshot = new OciCatalogAdapter().toSnapshot(
      [{
        partNumber: 'B91961',
        displayName: 'Storage - Block Volume - Storage',
        metricName: 'Gigabyte Storage Capacity Per Month',
        serviceCategory: 'Storage - Block Volumes',
        currencyCodeLocalizations: [{
          currencyCode: 'USD',
          prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0255 }],
        }],
      }],
      {
        region: 'sa-saopaulo-1',
        effectiveFrom: '2026-10-19T00:00:00Z',
      },
    );

    expect(snapshot.offerings[0].attributes).toMatchObject({
      pricingCompleteness: 'PARTIAL',
    });
  });

  it.each([
    {
      displayName: 'OCI Cache with Redis - Memory',
      metricName: 'Gigabyte Per Hour',
      serviceCategory: 'Databases - Cache with Redis',
      expectedKind: 'REDIS_CACHE',
      expectedEngine: 'Redis',
    },
    {
      displayName: 'Oracle Container Engine for Kubernetes - Enhanced Cluster',
      metricName: 'Cluster Per Hour',
      serviceCategory: 'Containers',
      expectedKind: 'KUBERNETES',
    },
    {
      displayName: 'Load Balancer Base Instance',
      metricName: 'Load Balancer Hour',
      serviceCategory: 'Networking - Load Balancer',
      expectedKind: 'LOAD_BALANCER',
    },
    {
      displayName: 'Web Application Firewall - Requests',
      metricName: '10,000 Requests',
      serviceCategory: 'Security - Web Application Firewall',
      expectedKind: 'WAF',
    },
    {
      displayName: 'Block Volume Storage',
      metricName: 'Gigabyte Storage Capacity Per Month',
      serviceCategory: 'Storage',
      expectedKind: 'BLOCK_STORAGE',
    },
    {
      displayName: 'OCI Queue',
      metricName: '1,000,000 Requests',
      serviceCategory: 'OCI Queue',
      expectedKind: 'QUEUE',
    },
    {
      displayName: 'Networking - DNS',
      metricName: '1,000,000 Queries',
      serviceCategory: 'Networking - DNS',
      expectedKind: 'DNS',
    },
    {
      displayName: 'File Storage - Storage',
      metricName: 'Gigabyte Storage Capacity Per Month',
      serviceCategory: 'Storage - File Storage',
      expectedKind: 'FILE_STORAGE',
    },
    {
      displayName: 'Key Management Service - Key Versions',
      metricName: 'Key Version Per Month',
      serviceCategory: 'Security - Key Management',
      expectedKind: 'KEY_MANAGEMENT',
    },
  ])(
    'reconhece $expectedKind na lista pública da OCI',
    ({
      displayName,
      metricName,
      serviceCategory,
      expectedKind,
      expectedEngine,
    }) => {
      const snapshot = new OciCatalogAdapter().toSnapshot(
        [{
          partNumber: `TEST-${expectedKind}`,
          displayName,
          metricName,
          serviceCategory,
          currencyCodeLocalizations: [{
            currencyCode: 'USD',
            prices: [{ model: 'PAY_AS_YOU_GO', value: 0.01 }],
          }],
        }],
        {
          region: 'sa-saopaulo-1',
          effectiveFrom: '2026-10-05T00:00:00Z',
        },
      );

      expect(snapshot.services[0].resourceKind).toBe(expectedKind);
      if (expectedEngine) {
        expect(snapshot.offerings[0].engine).toBe(expectedEngine);
      }
    },
  );
});
