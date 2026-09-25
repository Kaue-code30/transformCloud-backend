import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingOrchestratorService } from './pricing/pricing-orchestrator.service';
import { ClaudeService } from './ai/claude.service';
import { DeterministicMappingService } from './mapping/deterministic-mapping.service';
import { PipelineService } from './pipeline.service';
import { BillingController } from './billing.controller';

@Module({
  imports: [CatalogModule],
  controllers: [BillingController],
  providers: [
    PricingOrchestratorService,
    DeterministicMappingService,
    ClaudeService,
    PipelineService,
  ],
  exports: [PipelineService],
})
export class BillingModule {}
