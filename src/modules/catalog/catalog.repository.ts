import { Injectable } from '@nestjs/common';
import {
  CatalogPriceType,
  CloudProvider,
  MappingOverrideStatus,
  Prisma,
  ResourceKind,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CatalogOfferingView,
  CatalogProvider,
  CatalogResourceKind,
} from './catalog.types';

const offeringInclude = {
  service: true,
  meters: {
    include: {
      meter: {
        include: { tiers: { orderBy: { startQuantity: 'asc' as const } } },
      },
    },
  },
} satisfies Prisma.ProviderOfferingInclude;

export type OfferingWithPrices = Prisma.ProviderOfferingGetPayload<{
  include: typeof offeringInclude;
}>;

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOfferingByNativeIdentity(params: {
    provider: CatalogProvider;
    nativeSkuName?: string;
    nativeProductId?: string;
    region?: string;
    engine?: string | null;
  }): Promise<CatalogOfferingView | null> {
    if (!params.nativeSkuName && !params.nativeProductId) return null;

    const offering = await this.prisma.providerOffering.findFirst({
      where: {
        provider: params.provider as CloudProvider,
        active: true,
        ...catalogSourceFilter(),
        ...(params.region ? { region: params.region } : {}),
        ...(params.engine
          ? { engine: { equals: params.engine, mode: 'insensitive' } }
          : {}),
        OR: [
          ...(params.nativeSkuName
            ? [{ nativeSkuName: { equals: params.nativeSkuName, mode: 'insensitive' as const } }]
            : []),
          ...(params.nativeProductId
            ? [{ nativeProductId: params.nativeProductId }]
            : []),
        ],
      },
      include: { service: true },
      orderBy: { sourceKey: 'asc' },
    });

    return offering ? toOfferingView(offering) : null;
  }

  async findOfferingByMeterIdentity(params: {
    provider: CatalogProvider;
    skuId?: string;
    meterId?: string;
    nativeSkuName?: string;
    region?: string;
  }): Promise<CatalogOfferingView | null> {
    if (!params.skuId && !params.meterId) return null;

    const offering = await this.prisma.providerOffering.findFirst({
      where: {
        provider: params.provider as CloudProvider,
        active: true,
        ...catalogSourceFilter(),
        ...(params.region ? { region: params.region } : {}),
        ...(params.nativeSkuName
          ? { nativeSkuName: { equals: params.nativeSkuName, mode: 'insensitive' } }
          : {}),
        meters: {
          some: {
            meter: {
              OR: [
                ...(params.skuId ? [{ nativeSkuId: params.skuId }] : []),
                ...(params.meterId ? [{ nativeMeterId: params.meterId }] : []),
              ],
            },
          },
        },
      },
      include: { service: true },
      orderBy: { sourceKey: 'asc' },
    });

    return offering ? toOfferingView(offering) : null;
  }

  async findComputeCandidates(params: {
    provider: CatalogProvider;
    region?: string;
    operatingSystem?: string | null;
    architecture?: string | null;
    minimumVcpu: number;
    minimumMemoryGiB: number;
  }): Promise<CatalogOfferingView[]> {
    const baseWhere: Prisma.ProviderOfferingWhereInput = {
      provider: params.provider as CloudProvider,
      active: true,
      ...catalogSourceFilter(),
      purchaseOption: 'ON_DEMAND',
      service: { resourceKind: ResourceKind.COMPUTE_VM },
      vcpu: { gte: new Prisma.Decimal(params.minimumVcpu) },
      memoryGiB: { gte: new Prisma.Decimal(params.minimumMemoryGiB) },
      ...(params.operatingSystem
        ? { operatingSystem: { equals: params.operatingSystem, mode: 'insensitive' } }
        : {}),
      ...(params.architecture
        ? { architecture: { equals: params.architecture, mode: 'insensitive' } }
        : {}),
    };
    let offerings = await this.prisma.providerOffering.findMany({
      where: {
        ...baseWhere,
        ...(params.region ? { region: params.region } : {}),
      },
      include: { service: true },
      take: 500,
    });

    let regionOverride: string | undefined;
    if (!offerings.length && params.provider === 'OCI' && params.region) {
      offerings = await this.prisma.providerOffering.findMany({
        where: {
          ...baseWhere,
          attributes: { path: ['globalListPrice'], equals: true },
        },
        include: { service: true },
        take: 500,
      });
      regionOverride = params.region;
    }

    return offerings.map((offering) => toOfferingView(offering, regionOverride));
  }

  async findResourceCandidates(params: {
    provider: CatalogProvider;
    resourceKind: CatalogResourceKind;
    region: string;
    engine?: string | null;
    minimumVcpu?: number | null;
    minimumMemoryGiB?: number | null;
    pricingUnits?: string[];
  }): Promise<CatalogOfferingView[]> {
    const baseWhere: Prisma.ProviderOfferingWhereInput = {
      provider: params.provider as CloudProvider,
      active: true,
      ...catalogSourceFilter(),
      purchaseOption: 'ON_DEMAND',
      service: { resourceKind: params.resourceKind as ResourceKind },
      ...(params.pricingUnits?.length
        ? { meters: { some: { meter: { pricingUnit: { in: params.pricingUnits } } } } }
        : {}),
      ...(params.engine
        ? { engine: { equals: params.engine, mode: 'insensitive' } }
        : {}),
      ...(params.minimumVcpu
        ? { vcpu: { gte: new Prisma.Decimal(params.minimumVcpu) } }
        : {}),
      ...(params.minimumMemoryGiB
        ? { memoryGiB: { gte: new Prisma.Decimal(params.minimumMemoryGiB) } }
        : {}),
    };
    let offerings = await this.prisma.providerOffering.findMany({
      where: {
        ...baseWhere,
        region: params.region,
      },
      include: { service: true },
      take: 500,
    });

    let regionOverride: string | undefined;
    if (!offerings.length && params.provider === 'OCI') {
      offerings = await this.prisma.providerOffering.findMany({
        where: {
          ...baseWhere,
          attributes: { path: ['globalListPrice'], equals: true },
        },
        include: { service: true },
        take: 500,
      });
      regionOverride = params.region;
    }

    return offerings.map((offering) => toOfferingView(offering, regionOverride));
  }

  async findApprovedOverride(
    sourceOfferingId: string,
    targetProvider: CatalogProvider,
  ): Promise<CatalogOfferingView | null> {
    const override = await this.prisma.mappingOverride.findFirst({
      where: {
        sourceOfferingId,
        targetProvider: targetProvider as CloudProvider,
        status: MappingOverrideStatus.APPROVED,
      },
      include: {
        targetOffering: { include: { service: true } },
      },
    });

    return override ? toOfferingView(override.targetOffering) : null;
  }

  getOfferingWithPrices(id: string): Promise<OfferingWithPrices | null> {
    return this.prisma.providerOffering.findUnique({
      where: { id },
      include: offeringInclude,
    });
  }

  provider(value: CatalogProvider): CloudProvider {
    return value as CloudProvider;
  }

  resourceKind(value: CatalogResourceKind): ResourceKind {
    return value as ResourceKind;
  }

  priceType(value: string): CatalogPriceType {
    return value as CatalogPriceType;
  }
}

function catalogSourceFilter(): Prisma.ProviderOfferingWhereInput {
  if (process.env.CATALOG_ALLOW_TEST_FIXTURES?.toLowerCase() === 'true') {
    return {};
  }
  return { NOT: { sourceKey: { startsWith: 'TEST:' } } };
}

function toOfferingView(
  offering: Prisma.ProviderOfferingGetPayload<{ include: { service: true } }>,
  regionOverride?: string,
): CatalogOfferingView {
  return {
    id: offering.id,
    sourceKey: offering.sourceKey,
    provider: offering.provider as CatalogProvider,
    resourceKind: offering.service.resourceKind as CatalogResourceKind,
    serviceName: offering.service.name,
    serviceNativeCode: offering.service.nativeCode,
    nativeProductId: offering.nativeProductId,
    nativeSkuName: offering.nativeSkuName,
    displayName: offering.displayName,
    region: regionOverride ?? offering.region,
    purchaseOption: offering.purchaseOption,
    operatingSystem: offering.operatingSystem,
    architecture: offering.architecture,
    family: offering.family,
    generation: offering.generation,
    engine: offering.engine,
    vcpu: offering.vcpu?.toNumber() ?? null,
    memoryGiB: offering.memoryGiB?.toNumber() ?? null,
    highAvailability: offering.highAvailability,
  };
}
