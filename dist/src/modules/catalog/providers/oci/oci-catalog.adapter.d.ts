import type { CatalogResourceKind, CatalogSnapshot } from '../../catalog.types';
interface OciPriceRange {
    model?: string;
    value?: number | string;
    rangeMin?: number | string;
    rangeMax?: number | string;
    rangeUnit?: string;
}
interface OciCurrencyPrices {
    currencyCode?: string;
    prices?: OciPriceRange[];
}
export interface OciPriceProduct {
    partNumber: string;
    displayName: string;
    description?: string;
    metricName: string;
    serviceCategory: string;
    currencyCodeLocalizations?: OciCurrencyPrices[];
    prices?: OciCurrencyPrices[];
    [key: string]: unknown;
}
export interface OciCatalogSyncOptions {
    region: string;
    currency?: string;
    partNumber?: string;
    partNumbers?: string[];
    match?: string;
    maxProducts?: number;
    resourceKind?: CatalogResourceKind;
    offeringName?: string;
    vcpu?: number;
    ocpu?: number;
    memoryGiB?: number;
    operatingSystem?: string;
    architecture?: string;
    engine?: string;
    effectiveFrom?: string;
}
export declare class OciCatalogAdapter {
    private readonly baseUrl;
    download(options: OciCatalogSyncOptions): Promise<CatalogSnapshot>;
    toSnapshot(products: OciPriceProduct[], options: OciCatalogSyncOptions): CatalogSnapshot;
    private fetchJson;
}
export {};
