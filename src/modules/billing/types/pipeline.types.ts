// ─── Etapa 1: Parsing ────────────────────────────────────────────────────────

export type CloudProvider = 'AWS' | 'GCP' | 'AZURE' | 'OCI';
export type DataQuality = 'good' | 'partial' | 'poor';

export interface TopService {
  sourceLineItemKey?: string;
  name: string;
  specs: string;
  cost: number;
  pct: number;
  quantity: string;
  /** Identificadores nativos preservados pelo parser, quando disponíveis. */
  nativeSkuName?: string;
  nativeProductId?: string;
  region?: string;
  operatingSystem?: string;
  architecture?: string;
  vcpu?: number;
  memoryGiB?: number;
  usageQuantity?: number;
  usageUnit?: string;
}

export interface BillingLineItem {
  sourceKey?: string;
  provider: CloudProvider;
  serviceCode: string;
  serviceName?: string;
  skuId?: string;
  meterId?: string;
  nativeSkuName?: string;
  nativeProductId?: string;
  usageType?: string;
  operation?: string;
  region: string;
  resourceId?: string;
  quantity: number;
  unit: string;
  cost: number;
  currency: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface ParsedBilling {
  provider: CloudProvider;
  period: { start: string; end: string };
  currency: string;
  totalCost: number;
  dataQuality: DataQuality;
  topServices: TopService[];
  /** Linhas nativas do billing. topServices continua aceito durante a migração. */
  lineItems?: BillingLineItem[];
  /**
   * Restrição geográfica do cliente (opcional).
   * Ex: "Brasil", "América do Norte", "Europa", "us-east-1", "southamerica-east1"
   * Quando informado, o mapeamento de serviços priorizará regiões equivalentes nos provedores destino.
   */
  targetRegion?: string;
}

// ─── Etapa 2: Mapeamento determinístico pelo catálogo ─────────────────────────

export type Confidence = 'high' | 'medium' | 'low';
export type MappingMatchType =
  | 'manual_override'
  | 'exact_capacity'
  | 'capacity_match'
  | 'resource_kind_match';

export interface MappingMetadata {
  catalogOfferingId: string;
  matchType: MappingMatchType;
  score: number;
  evidence: string[];
}

export interface GcpMapping extends MappingMetadata {
  service: string;
  machineType?: string;
  tier?: string;
  region?: string;
  highAvailability?: boolean;
  confidence: Confidence;
}

export interface AzureMapping extends MappingMetadata {
  service: string;
  skuName?: string;
  sku?: string;
  region?: string;
  confidence: Confidence;
}

export interface OciMapping extends MappingMetadata {
  service: string;
  shape?: string;
  ocpu?: number;
  memoryGb?: number;
  confidence: Confidence;
}

export interface AwsMapping extends MappingMetadata {
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
  unmapped: Array<{ service: string; reason: string }>;
}

// ─── Etapa 3: Preços reais ────────────────────────────────────────────────────

export type VerificationStatus = 'verified' | 'partial' | 'not_found' | 'no_api';

export interface PriceEntry {
  price: number | null;
  unit?: string;
  currency?: string;
  estimatedMonthly?: number | null;
  source?: string;
  effectiveFrom?: string;
  catalogOfferingId?: string;
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

// ─── Etapa 5: decisão por código + redação opcional por IA ───────────────────

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
    paybackMonths: number;
    roi12m: number;
    roi24m: number;
    roi36m: number;
    breakEvenMonth: number;
    disclaimer: string;
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
}

// ─── SSE — eventos de progresso ──────────────────────────────────────────────

export type PipelineStep =
  | 'mapping'
  | 'pricing'
  | 'classification'
  | 'recommendation'
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
