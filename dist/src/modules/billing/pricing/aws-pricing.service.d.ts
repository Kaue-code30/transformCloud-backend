import { PriceEntry } from '../types/pipeline.types';
export interface AwsPricingParams {
    service: 'AmazonEC2' | 'AmazonRDS' | 'AmazonS3' | 'AWSLambda' | string;
    region: string;
    instanceType?: string;
    operatingSystem?: string;
    databaseEngine?: string;
    deploymentOption?: string;
}
export declare class AwsPricingService {
    private readonly logger;
    getPrice(params: AwsPricingParams, quantityHours: number): Promise<PriceEntry>;
    private findProductSku;
    private extractHourlyPrice;
}
