import { CatalogPricingService } from '../../catalog/catalog-pricing.service';
import type { BillingLineItem, ClassificationResult, CloudProvider, MappingResult, TopService } from '../types/pipeline.types';
export declare class PricingOrchestratorService {
    private readonly catalogPricing;
    constructor(catalogPricing: CatalogPricingService);
    fetchPrices(billing: {
        provider: CloudProvider;
        totalCost: number;
        currency: string;
        topServices: TopService[];
        lineItems?: BillingLineItem[];
    }, mappings: MappingResult): Promise<ClassificationResult>;
    private fetchServicePrice;
    private priceForMapping;
    private classify;
    private resolveStatus;
}
