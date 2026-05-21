export type CloudProvider = 'AWS' | 'GCP' | 'AZURE' | 'OCI';
export type DataQuality = 'good' | 'partial' | 'poor';
export interface TopService {
    name: string;
    specs: string;
    cost: number;
    pct: number;
    quantity: string;
}
export interface ParsedBilling {
    provider: CloudProvider;
    period: {
        start: string;
        end: string;
    };
    currency: string;
    totalCost: number;
    dataQuality: DataQuality;
    topServices: TopService[];
}
export type Confidence = 'high' | 'medium' | 'low';
export interface GcpMapping {
    service: string;
    machineType?: string;
    tier?: string;
    region?: string;
    highAvailability?: boolean;
    confidence: Confidence;
}
export interface AzureMapping {
    service: string;
    skuName?: string;
    sku?: string;
    region?: string;
    confidence: Confidence;
}
export interface OciMapping {
    service: string;
    shape?: string;
    ocpu?: number;
    memoryGb?: number;
    confidence: Confidence;
}
export interface ServiceMapping {
    original: string;
    gcp?: GcpMapping;
    azure?: AzureMapping;
    oci?: OciMapping;
}
export interface MappingResult {
    mappings: ServiceMapping[];
}
export type VerificationStatus = 'verified' | 'partial' | 'not_found' | 'no_api';
export interface PriceEntry {
    price: number | null;
    unit?: string;
    estimatedMonthly?: number | null;
    source?: string;
    verified: boolean;
    reason?: string;
}
export interface ServicePrice {
    service: string;
    currentCost: number;
    gcp: PriceEntry;
    azure: PriceEntry;
    oci: PriceEntry;
}
export interface PricingResult {
    prices: ServicePrice[];
}
export interface ClassifiedPrice extends ServicePrice {
    gcpStatus: VerificationStatus;
    azureStatus: VerificationStatus;
    ociStatus: VerificationStatus;
}
export interface ClassificationResult {
    classified: ClassifiedPrice[];
    meta: {
        analyzedServices: number;
        verifiedServices: number;
        partialServices: number;
        notFoundServices: number;
        coveredCostPct: number;
    };
}
export interface RecommendationResult {
    recommendation: {
        provider: CloudProvider;
        basedOnVerified: boolean;
        migrationComplexity: string;
        reasons: string[];
        topServices: string[];
        cfa_justification: string;
    };
    insights: string[];
    summary: string;
}
export interface PaybackResult {
    payback: {
        basedOnVerified: boolean;
        coveredCostPct: number;
        monthlySaving: number;
        migrationCost: number;
        paybackMonths: number;
        roi12m: number;
        roi24m: number;
        roi36m: number;
        breakEvenMonth: number;
        disclaimer: string;
    };
}
export interface PipelineResult {
    meta: ClassificationResult['meta'] & {
        analysisDate: string;
    };
    billing: ParsedBilling;
    mappings: MappingResult;
    prices: ClassificationResult;
    recommendation: RecommendationResult;
    payback: PaybackResult;
}
