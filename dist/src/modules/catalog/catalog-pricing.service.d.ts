import { CatalogRepository } from './catalog.repository';
import type { CatalogPriceResult } from './catalog.types';
export declare class CatalogPricingService {
    private readonly catalog;
    constructor(catalog: CatalogRepository);
    calculate(offeringId: string, usageQuantity: number): Promise<CatalogPriceResult | null>;
}
