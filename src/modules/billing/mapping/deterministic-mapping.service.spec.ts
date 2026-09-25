import { DeterministicMappingService } from './deterministic-mapping.service';
import type { CatalogRepository } from '../../catalog/catalog.repository';
import type { CatalogOfferingView } from '../../catalog/catalog.types';
import type { ParsedBilling } from '../types/pipeline.types';

describe('DeterministicMappingService', () => {
  it('mapeia compute por capacidade sem consultar IA', async () => {
    const source = offering({
      id: 'aws-m7g-2xlarge',
      provider: 'AWS',
      nativeSkuName: 'm7g.2xlarge',
      region: 'sa-east-1',
      architecture: 'arm64',
      operatingSystem: 'Linux',
      vcpu: 8,
      memoryGiB: 32,
    });
    const gcp = offering({
      id: 'gcp-t2a-standard-8',
      provider: 'GCP',
      nativeSkuName: 't2a-standard-8',
      region: 'southamerica-east1',
      architecture: 'arm64',
      operatingSystem: 'Linux',
      vcpu: 8,
      memoryGiB: 32,
      serviceName: 'Compute Engine',
      serviceNativeCode: 'compute.googleapis.com',
    });
    const azure = offering({
      id: 'azure-arm-8-32',
      provider: 'AZURE',
      nativeSkuName: 'Standard_D8ps_v5',
      region: 'brazilsouth',
      architecture: 'arm64',
      operatingSystem: 'Linux',
      vcpu: 8,
      memoryGiB: 32,
      serviceName: 'Virtual Machines',
      serviceNativeCode: 'Microsoft.Compute/virtualMachines',
    });

    const catalog = {
      findOfferingByMeterIdentity: jest.fn().mockResolvedValue(null),
      findOfferingByNativeIdentity: jest.fn().mockResolvedValue(source),
      findApprovedOverride: jest.fn().mockResolvedValue(null),
      findComputeCandidates: jest.fn().mockImplementation(({ provider }) => {
        if (provider === 'GCP') return Promise.resolve([gcp]);
        if (provider === 'AZURE') return Promise.resolve([azure]);
        return Promise.resolve([]);
      }),
    } as unknown as CatalogRepository;
    const service = new DeterministicMappingService(catalog);

    const result = await service.mapServices(billing());

    expect(result.unmapped).toEqual([]);
    expect(result.mappings[0].aws).toBeUndefined();
    expect(result.mappings[0].gcp).toMatchObject({
      catalogOfferingId: 'gcp-t2a-standard-8',
      machineType: 't2a-standard-8',
      region: 'southamerica-east1',
      confidence: 'high',
      matchType: 'exact_capacity',
    });
    expect(result.mappings[0].azure).toMatchObject({
      catalogOfferingId: 'azure-arm-8-32',
      skuName: 'Standard_D8ps_v5',
      confidence: 'high',
    });
  });

  it('mapeia banco pelo tipo de recurso, engine e capacidade do catálogo', async () => {
    const source = offering({
      id: 'aws-rds-postgres',
      provider: 'AWS',
      resourceKind: 'MANAGED_POSTGRES',
      serviceName: 'Amazon RDS PostgreSQL',
      serviceNativeCode: 'AmazonRDS',
      nativeSkuName: 'db.r6g.large',
      engine: 'PostgreSQL',
      vcpu: 2,
      memoryGiB: 16,
    });
    const target = offering({
      id: 'gcp-cloudsql-postgres',
      provider: 'GCP',
      resourceKind: 'MANAGED_POSTGRES',
      serviceName: 'Cloud SQL for PostgreSQL',
      serviceNativeCode: 'sqladmin.googleapis.com',
      nativeSkuName: 'db-custom-2-16384',
      region: 'southamerica-east1',
      engine: 'PostgreSQL',
      vcpu: 2,
      memoryGiB: 16,
    });
    const findComputeCandidates = jest.fn();
    const catalog = {
      findOfferingByMeterIdentity: jest.fn().mockResolvedValue(source),
      findOfferingByNativeIdentity: jest.fn(),
      findApprovedOverride: jest.fn().mockResolvedValue(null),
      findComputeCandidates,
      findResourceCandidates: jest.fn().mockImplementation(({ provider }) =>
        Promise.resolve(provider === 'GCP' ? [target] : []),
      ),
    } as unknown as CatalogRepository;
    const service = new DeterministicMappingService(catalog);
    const input = billing();
    input.topServices[0] = {
      sourceLineItemKey: 'rds-line',
      name: 'Amazon RDS — db.r6g.large',
      specs: 'db.r6g.large, PostgreSQL',
      cost: 180,
      pct: 100,
      quantity: '160 Hrs',
    };
    input.lineItems = [{
      sourceKey: 'rds-line',
      provider: 'AWS',
      serviceCode: 'AmazonRDS',
      serviceName: 'Amazon RDS',
      skuId: 'aws-sku-rds-db-r6g-large',
      meterId: 'aws-meter-rds-db-r6g-large',
      region: 'sa-east-1',
      quantity: 160,
      unit: 'Hrs',
      cost: 180,
      currency: 'USD',
    }];

    const result = await service.mapServices(input);

    expect(result.mappings[0].gcp).toMatchObject({
      catalogOfferingId: 'gcp-cloudsql-postgres',
      machineType: 'db-custom-2-16384',
      matchType: 'exact_capacity',
      confidence: 'high',
    });
    expect(findComputeCandidates).not.toHaveBeenCalled();
  });

  it('retorna motivo explícito quando o SKU de origem não pode ser resolvido', async () => {
    const catalog = {
      findOfferingByMeterIdentity: jest.fn().mockResolvedValue(null),
      findOfferingByNativeIdentity: jest.fn().mockResolvedValue(null),
    } as unknown as CatalogRepository;
    const service = new DeterministicMappingService(catalog);
    const input = billing();
    input.topServices[0] = {
      name: 'Amazon EC2',
      specs: 'sem especificações',
      quantity: '730 horas',
      cost: 100,
      pct: 100,
    };

    const result = await service.mapServices(input);

    expect(result.mappings[0]).toEqual({ original: 'Amazon EC2' });
    expect(result.unmapped[0].reason).toContain('capacidade');
  });

  it('não reutiliza ofertas de compute para mapear banco de dados', async () => {
    const findComputeCandidates = jest.fn().mockResolvedValue([]);
    const catalog = {
      findOfferingByMeterIdentity: jest.fn().mockResolvedValue(null),
      findOfferingByNativeIdentity: jest.fn().mockResolvedValue(null),
      findComputeCandidates,
    } as unknown as CatalogRepository;
    const service = new DeterministicMappingService(catalog);
    const input = billing();
    input.totalCost = 180;
    input.topServices[0] = {
      sourceLineItemKey: 'rds-line',
      name: 'Amazon RDS — db.r6g.large',
      specs: 'db.r6g.large, sa-east-1, Linux, arm64',
      nativeSkuName: 'db.r6g.large',
      region: 'sa-east-1',
      vcpu: 2,
      memoryGiB: 16,
      usageQuantity: 160,
      usageUnit: 'Hrs',
      quantity: '160 Hrs',
      cost: 180,
      pct: 100,
    };
    input.lineItems = [
      {
        sourceKey: 'rds-line',
        provider: 'AWS',
        serviceCode: 'AmazonRDS',
        serviceName: 'Amazon RDS',
        nativeSkuName: 'db.r6g.large',
        region: 'sa-east-1',
        quantity: 160,
        unit: 'Hrs',
        cost: 180,
        currency: 'USD',
        attributes: { vcpu: 2, memoryGiB: 16 },
      },
    ];

    const result = await service.mapServices(input);

    expect(result.mappings[0]).toEqual({
      original: 'Amazon RDS — db.r6g.large',
    });
    expect(result.unmapped[0].reason).toContain('estratégia determinística');
    expect(findComputeCandidates).not.toHaveBeenCalled();
  });
});

function billing(): ParsedBilling {
  return {
    provider: 'AWS',
    period: { start: '2026-09-01', end: '2026-09-30' },
    currency: 'USD',
    totalCost: 100,
    dataQuality: 'good',
    targetRegion: 'Brasil',
    topServices: [
      {
        name: 'Amazon EC2',
        specs: 'm7g.2xlarge, sa-east-1, Linux, arm64',
        nativeSkuName: 'm7g.2xlarge',
        region: 'sa-east-1',
        quantity: '730 horas',
        cost: 100,
        pct: 100,
      },
    ],
  };
}

function offering(
  overrides: Partial<CatalogOfferingView>,
): CatalogOfferingView {
  return {
    id: 'offering',
    provider: 'AWS',
    resourceKind: 'COMPUTE_VM',
    serviceName: 'Amazon EC2',
    serviceNativeCode: 'AmazonEC2',
    nativeProductId: null,
    nativeSkuName: 'm7g.2xlarge',
    displayName: 'm7g.2xlarge',
    region: 'sa-east-1',
    purchaseOption: 'ON_DEMAND',
    operatingSystem: 'Linux',
    architecture: 'arm64',
    family: 'm7g',
    generation: '7',
    engine: null,
    vcpu: 8,
    memoryGiB: 32,
    highAvailability: null,
    ...overrides,
  };
}
