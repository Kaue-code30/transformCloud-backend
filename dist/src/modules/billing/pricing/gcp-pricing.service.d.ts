import { ConfigService } from '@nestjs/config';
import { GcpMapping, PriceEntry } from '../types/pipeline.types';
export declare class GcpPricingService {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    getPrice(mapping: GcpMapping, quantityHours: number): Promise<PriceEntry>;
    private findSku;
    private extractHourlyPrice;
}
