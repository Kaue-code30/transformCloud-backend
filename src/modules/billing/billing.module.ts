import { Module } from '@nestjs/common';
import { AzurePricingService } from './pricing/azure-pricing.service';
import { AwsPricingService } from './pricing/aws-pricing.service';
import { GcpPricingService } from './pricing/gcp-pricing.service';
import { PricingOrchestratorService } from './pricing/pricing-orchestrator.service';
import { CatalogFetcherService } from './pricing/catalog-fetcher.service';
import { ClaudeService } from './ai/claude.service';
import { MappingService } from './mapping/mapping.service';
import { PipelineService } from './pipeline.service';
import { BillingController } from './billing.controller';

@Module({
  controllers: [BillingController],
  providers: [
    AzurePricingService,
    AwsPricingService,
    GcpPricingService,
    PricingOrchestratorService,
    CatalogFetcherService,
    ClaudeService,
    MappingService,
    PipelineService,
  ],
  exports: [PipelineService],
})
export class BillingModule {}
