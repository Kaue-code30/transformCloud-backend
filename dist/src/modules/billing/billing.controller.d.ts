import type { Response } from 'express';
import { PipelineService } from './pipeline.service';
import type { ParsedBilling } from './types/pipeline.types';
export declare class BillingController {
    private readonly pipeline;
    private readonly logger;
    constructor(pipeline: PipelineService);
    analyzeStream(billing: ParsedBilling, res: Response): void;
}
