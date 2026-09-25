import { CatalogPriceType, CloudProvider, Prisma, ResourceKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CatalogOfferingView, CatalogProvider, CatalogResourceKind } from './catalog.types';
declare const offeringInclude: {
    service: true;
    meters: {
        include: {
            meter: {
                include: {
                    tiers: {
                        orderBy: {
                            startQuantity: "asc";
                        };
                    };
                };
            };
        };
    };
};
export type OfferingWithPrices = Prisma.ProviderOfferingGetPayload<{
    include: typeof offeringInclude;
}>;
export declare class CatalogRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findOfferingByNativeIdentity(params: {
        provider: CatalogProvider;
        nativeSkuName?: string;
        nativeProductId?: string;
        region?: string;
    }): Promise<CatalogOfferingView | null>;
    findOfferingByMeterIdentity(params: {
        provider: CatalogProvider;
        skuId?: string;
        meterId?: string;
        nativeSkuName?: string;
        region?: string;
    }): Promise<CatalogOfferingView | null>;
    findComputeCandidates(params: {
        provider: CatalogProvider;
        region?: string;
        operatingSystem?: string | null;
        architecture?: string | null;
        minimumVcpu: number;
        minimumMemoryGiB: number;
    }): Promise<CatalogOfferingView[]>;
    findResourceCandidates(params: {
        provider: CatalogProvider;
        resourceKind: CatalogResourceKind;
        region: string;
        engine?: string | null;
        minimumVcpu?: number | null;
        minimumMemoryGiB?: number | null;
        pricingUnits?: string[];
    }): Promise<CatalogOfferingView[]>;
    findApprovedOverride(sourceOfferingId: string, targetProvider: CatalogProvider): Promise<CatalogOfferingView | null>;
    getOfferingWithPrices(id: string): Promise<OfferingWithPrices | null>;
    provider(value: CatalogProvider): CloudProvider;
    resourceKind(value: CatalogResourceKind): ResourceKind;
    priceType(value: string): CatalogPriceType;
}
export {};
