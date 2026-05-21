import { Module } from '@nestjs/common';
import { AzurePricingService } from './pricing/azure-pricing.service';
import { AwsPricingService } from './pricing/aws-pricing.service';
import { GcpPricingService } from './pricing/gcp-pricing.service';
import { PricingOrchestratorService } from './pricing/pricing-orchestrator.service';

@Module({
  providers: [
    AzurePricingService,
    AwsPricingService,
    GcpPricingService,
    PricingOrchestratorService,
  ],
  exports: [PricingOrchestratorService],
})
export class BillingModule {}