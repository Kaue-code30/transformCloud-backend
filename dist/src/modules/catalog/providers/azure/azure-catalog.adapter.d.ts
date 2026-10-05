import type { CatalogResourceKind, CatalogSnapshot } from '../../catalog.types';
export interface AzureRetailPriceItem {
    currencyCode?: string;
    tierMinimumUnits?: number;
    retailPrice?: number;
    unitPrice?: number;
    armRegionName?: string;
    location?: string;
    effectiveStartDate?: string;
    meterId?: string;
    meterName?: string;
    productId?: string;
    skuId?: string;
    productName?: string;
    skuName?: string;
    serviceName?: string;
    serviceId?: string;
    serviceFamily?: string;
    unitOfMeasure?: string;
    type?: string;
    priceType?: string;
    isPrimaryMeterRegion?: boolean;
    armSkuName?: string;
    [key: string]: unknown;
}
export interface AzureCatalogSyncOptions {
    service: string;
    region: string;
    currency?: string;
    match?: string;
    productName?: string;
    meterName?: string;
    skuName?: string;
    armSkuName?: string;
    maxItems?: number;
    resourceKind?: CatalogResourceKind;
    offeringName?: string;
    vcpu?: number;
    memoryGiB?: number;
    operatingSystem?: string;
    architecture?: string;
    engine?: string;
}
export declare class AzureCatalogAdapter {
    private readonly baseUrl;
    download(options: AzureCatalogSyncOptions): Promise<CatalogSnapshot>;
    toSnapshot(items: AzureRetailPriceItem[], options: AzureCatalogSyncOptions): CatalogSnapshot;
    private listItems;
    private fetchJson;
}
