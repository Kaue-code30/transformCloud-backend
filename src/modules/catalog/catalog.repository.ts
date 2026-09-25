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
  }): Promise<CatalogOfferingView | null> {
    if (!params.nativeSkuName && !params.nativeProductId) return null;

    const offering = await this.prisma.providerOffering.findFirst({
      where: {
        provider: params.provider as CloudProvider,
        active: true,
        ...(params.region ? { region: params.region } : {}),
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
    const offerings = await this.prisma.providerOffering.findMany({
      where: {
        provider: params.provider as CloudProvider,
        active: true,
        purchaseOption: 'ON_DEMAND',
        service: { resourceKind: ResourceKind.COMPUTE_VM },
        vcpu: { gte: new Prisma.Decimal(params.minimumVcpu) },
        memoryGiB: { gte: new Prisma.Decimal(params.minimumMemoryGiB) },
        ...(params.region ? { region: params.region } : {}),
        ...(params.operatingSystem
          ? { operatingSystem: { equals: params.operatingSystem, mode: 'insensitive' } }
          : {}),
        ...(params.architecture
          ? { architecture: { equals: params.architecture, mode: 'insensitive' } }
          : {}),
      },
      include: { service: true },
      take: 500,
    });

    return offerings.map(toOfferingView);
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
    const offerings = await this.prisma.providerOffering.findMany({
      where: {
        provider: params.provider as CloudProvider,
        active: true,
        purchaseOption: 'ON_DEMAND',
        region: params.region,
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
      },
      include: { service: true },
      take: 500,
    });

    return offerings.map(toOfferingView);
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

function toOfferingView(
  offering: Prisma.ProviderOfferingGetPayload<{ include: { service: true } }>,
): CatalogOfferingView {
  return {
    id: offering.id,
    provider: offering.provider as CatalogProvider,
    resourceKind: offering.service.resourceKind as CatalogResourceKind,
    serviceName: offering.service.name,
    serviceNativeCode: offering.service.nativeCode,
    nativeProductId: offering.nativeProductId,
    nativeSkuName: offering.nativeSkuName,
    displayName: offering.displayName,
    region: offering.region,
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
