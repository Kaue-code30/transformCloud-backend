import { Observable } from 'rxjs';
import { ClaudeService } from './ai/claude.service';
import { DeterministicMappingService } from './mapping/deterministic-mapping.service';
import { PricingOrchestratorService } from './pricing/pricing-orchestrator.service';
import type { ParsedBilling, PipelineProgressEvent } from './types/pipeline.types';
export declare class PipelineService {
    private readonly claude;
    private readonly mapping;
    private readonly pricing;
    constructor(claude: ClaudeService, mapping: DeterministicMappingService, pricing: PricingOrchestratorService);
    runStream(billing: ParsedBilling): Observable<PipelineProgressEvent>;
}
