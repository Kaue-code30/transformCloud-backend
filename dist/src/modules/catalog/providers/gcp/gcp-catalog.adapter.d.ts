import type { CatalogSnapshot } from '../../catalog.types';
interface GcpMoney {
    currencyCode?: string;
    units?: string;
    nanos?: number;
}
interface GcpPricingInfo {
    effectiveTime?: string;
    pricingExpression?: {
        usageUnit?: string;
        usageUnitDescription?: string;
        baseUnit?: string;
        baseUnitConversionFactor?: number;
        tieredRates?: Array<{
            startUsageAmount?: number | string;
            unitPrice?: GcpMoney;
        }>;
    };
}
interface GcpSku {
    name: string;
    skuId: string;
    description: string;
    serviceRegions?: string[];
    category?: {
        serviceDisplayName?: string;
        resourceFamily?: string;
        resourceGroup?: string;
        usageType?: string;
    };
    pricingInfo?: GcpPricingInfo[];
    [key: string]: unknown;
}
interface GcpService {
    name: string;
    serviceId: string;
    displayName: string;
}
export interface GcpCatalogSyncOptions {
    apiKey: string;
    service: string;
    region: string;
    match?: string;
    maxSkus?: number;
}
export declare class GcpCatalogAdapter {
    private readonly baseUrl;
    download(options: GcpCatalogSyncOptions): Promise<CatalogSnapshot>;
    toSnapshot(service: GcpService, skus: GcpSku[], options: Omit<GcpCatalogSyncOptions, 'apiKey'>): CatalogSnapshot;
    private resolveService;
    private listSkus;
    private fetchJson;
}
export {};
