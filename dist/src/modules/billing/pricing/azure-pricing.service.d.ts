import { AzureMapping, PriceEntry } from '../types/pipeline.types';
export declare class AzurePricingService {
    private readonly logger;
    getPrice(mapping: AzureMapping, quantityHours: number): Promise<PriceEntry>;
}
