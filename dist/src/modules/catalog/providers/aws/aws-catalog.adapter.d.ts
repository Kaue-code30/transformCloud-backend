import type { CatalogSnapshot } from '../../catalog.types';
interface AwsProduct {
    sku: string;
    productFamily?: string;
    attributes: Record<string, string | undefined>;
}
interface AwsPriceDimension {
    rateCode: string;
    description?: string;
    beginRange: string;
    endRange: string;
    unit: string;
    pricePerUnit: Record<string, string | undefined>;
}
interface AwsTerm {
    effectiveDate: string;
    priceDimensions: Record<string, AwsPriceDimension>;
    termAttributes?: Record<string, string>;
}
interface AwsOfferFile {
    publicationDate?: string;
    version?: string;
    products: Record<string, AwsProduct>;
    terms?: {
        OnDemand?: Record<string, Record<string, AwsTerm>>;
    };
}
export interface AwsCatalogSyncOptions {
    serviceCode: string;
    region: string;
    match?: string;
    maxProducts?: number;
}
export declare class AwsCatalogAdapter {
    download(options: AwsCatalogSyncOptions): Promise<CatalogSnapshot>;
    toSnapshot(payload: AwsOfferFile, options: AwsCatalogSyncOptions): CatalogSnapshot;
}
export {};
