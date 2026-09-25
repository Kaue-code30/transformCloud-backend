import { ConfigService } from '@nestjs/config';
import type { ParsedBilling, ClassificationResult, RecommendationResult } from '../types/pipeline.types';
export declare class ClaudeService {
    private readonly config;
    private readonly logger;
    private readonly client;
    private readonly enabled;
    private readonly model;
    private readonly systemPrompt;
    constructor(config: ConfigService);
    generateRecommendation(billing: ParsedBilling, prices: ClassificationResult): Promise<RecommendationResult>;
    private ask;
}
