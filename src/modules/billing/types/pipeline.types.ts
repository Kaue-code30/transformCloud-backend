// ─── Etapa 1: Parsing ────────────────────────────────────────────────────────

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
  period: { start: string; end: string };
  currency: string;
  totalCost: number;
  dataQuality: DataQuality;
  topServices: TopService[];
  /**
   * Restrição geográfica do cliente (opcional).
   * Ex: "Brasil", "América do Norte", "Europa", "us-east-1", "southamerica-east1"
   * Quando informado, o mapeamento de serviços priorizará regiões equivalentes nos provedores destino.
   */
  targetRegion?: string;
}

// ─── Etapa 2: Mapeamento (Claude) ─────────────────────────────────────────────

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

export interface AwsMapping {
  service: string;
  instanceType?: string;
  region?: string;
  operatingSystem?: string;
  databaseEngine?: string;
  confidence: Confidence;
}

export interface ServiceMapping {
  original: string;
  gcp?: GcpMapping;
  azure?: AzureMapping;
  oci?: OciMapping;
  aws?: AwsMapping;
}

export interface MappingResult {
  mappings: ServiceMapping[];
}

// ─── Etapa 3: Preços reais ────────────────────────────────────────────────────

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
  aws: PriceEntry;
}

export interface PricingResult {
  prices: ServicePrice[];
}

// ─── Etapa 4: Classificação ───────────────────────────────────────────────────

export interface ClassifiedPrice extends ServicePrice {
  gcpStatus: VerificationStatus;
  azureStatus: VerificationStatus;
  ociStatus: VerificationStatus;
  awsStatus: VerificationStatus;
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

// ─── Etapa 5: Recomendação (Claude) ──────────────────────────────────────────

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

// ─── Etapa 6: Payback ────────────────────────────────────────────────────────

export interface PaybackResult {
  payback: {
    basedOnVerified: boolean;
    coveredCostPct: number;
    monthlySaving: number;
    migrationCost: number;
    migrationCostBreakdown: {
      multiplier: number;          // sempre 3
      rationale: string;           // texto legível explicando o cálculo
      monthlyBase: number;         // = totalCost
    };
    paybackMonths: number;
    roi12m: number;
    roi24m: number;
    roi36m: number;
    breakEvenMonth: number;
    disclaimer: string;
  };
}

// ─── Etapa 7: Multicloud ─────────────────────────────────────────────────────

export interface MulticloudServiceAllocation {
  service: string;
  currentCost: number;
  recommendedProvider: CloudProvider;
  estimatedMonthlyCost: number;
  saving: number;
  reason: string;
}

export interface MulticloudResult {
  totalEstimatedMonthlyCost: number;
  totalMonthlySaving: number;
  savingPct: number;
  coveredServices: number;
  allocations: MulticloudServiceAllocation[];
  tradeoffs: {
    egressCostWarning: string;
    operationalComplexity: string;
    recommendation: string;
  };
  vsSingleProvider: {
    singleProviderSaving: number;
    multicloudExtraSaving: number;
    worthIt: boolean;
    justification: string;
  };
}

// ─── Resposta final ───────────────────────────────────────────────────────────

export interface PipelineResult {
  meta: ClassificationResult['meta'] & { analysisDate: string };
  billing: ParsedBilling;
  mappings: MappingResult;
  prices: ClassificationResult;
  recommendation: RecommendationResult;
  payback: PaybackResult;
  multicloud: MulticloudResult;
}

// ─── SSE — eventos de progresso ──────────────────────────────────────────────

export type PipelineStep =
  | 'mapping'
  | 'pricing'
  | 'classification'
  | 'recommendation'
  | 'multicloud'
  | 'payback'
  | 'done'
  | 'error';

export interface PipelineProgressEvent {
  step: PipelineStep;
  /** Mensagem legível para exibir na UI */
  message: string;
  /** Dado parcial disponível neste ponto — presente apenas em alguns steps */
  data?: Partial<PipelineResult>;
}