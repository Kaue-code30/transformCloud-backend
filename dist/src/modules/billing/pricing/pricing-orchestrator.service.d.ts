import { AzurePricingService } from './azure-pricing.service';
import { AwsPricingService } from './aws-pricing.service';
import { GcpPricingService } from './gcp-pricing.service';
import { ParsedBilling, MappingResult, ClassificationResult } from '../types/pipeline.types';
export declare class PricingOrchestratorService {
    private readonly azure;
    private readonly aws;
    private readonly gcp;
    constructor(azure: AzurePricingService, aws: AwsPricingService, gcp: GcpPricingService);
    fetchPrices(billing: ParsedBilling, mappings: MappingResult): Promise<ClassificationResult>;
    private fetchServicePrice;
    private classify;
    private resolveStatus;
    private notAvailable;
    private estimateHours;
}
