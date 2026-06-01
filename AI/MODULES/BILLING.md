# Módulo: Billing — Pipeline V2

> Atualizado em: 2026-06-01
> Status: Funcional — 7 etapas, 4 provedores (GCP/Azure/AWS/OCI), catálogo local com sync automático

---

## Visão Geral

Pipeline de análise de billing em 7 etapas. O frontend parseia o arquivo e envia o resultado estruturado; o backend orquestra mapeamento IA + APIs de preço + recomendação IA + análise multicloud.

```
Frontend (parse)
    ↓ POST /api/billing/analyze/stream
[1] normalizeBilling  — remove não-técnicos/SavingsPlans, canonicaliza nomes, top 6
[2] Mapeamento A+B+C  — tabela estática → Claude+catálogo → validação
[3] Preços reais      — GCP / Azure / AWS / OCI em paralelo
[4] Classificação     — verified / partial / not_found / no_api
[5] Recomendação      — Claude Opus (melhor provedor único)
[6] Payback/ROI       — código (12/24/36 meses + breakdown migração)
[7] Multicloud        — Claude Opus (alocação ótima por serviço)
    ↓ SSE events → frontend
```

---

## Arquivos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `billing.controller.ts` | `POST /analyze/stream` — SSE manual via `@Res()` |
| `pipeline.service.ts` | Orquestra as 7 etapas, emite `Observable<PipelineProgressEvent>` |
| `ai/claude.service.ts` | Etapas 2B, 5, 7 — Claude com prompt caching |
| `catalog/catalog-sync.service.ts` | `OnApplicationBootstrap` — baixa e salva catálogos (TTL 24h) |
| `catalog/catalog-validator.service.ts` | Etapa C — valida SKUs do Claude contra catálogo local |
| `mapping/mapping.service.ts` | Etapa 2 — orquestra A (estático) + B (Claude) + C (validação) |
| `pricing/pricing-orchestrator.service.ts` | Etapas 3+4 — 4 provedores em paralelo + classificação |
| `pricing/azure-pricing.service.ts` | Azure Retail Prices API |
| `pricing/gcp-pricing.service.ts` | GCP Cloud Billing API |
| `pricing/aws-pricing.service.ts` | AWS Pricing API + cache em memória |
| `pricing/oci-pricing.service.ts` | OCI Pricing API (Flex + fixed shapes) |
| `pricing/catalog-fetcher.service.ts` | Monta `AvailableCatalog` para o Claude (constraint B) |
| `pricing/sku-catalog.ts` | Tabela estática ~50 instanceTypes + listas de SKUs válidos |
| `types/pipeline.types.ts` | Todos os tipos TypeScript |

---

## Tipos principais (`pipeline.types.ts`)

```ts
interface ParsedBilling {
  provider: 'AWS' | 'GCP' | 'AZURE' | 'OCI';
  period: { start: string; end: string };
  currency: string;
  totalCost: number;
  dataQuality: 'good' | 'partial' | 'poor';
  topServices: TopService[];
  targetRegion?: string;
}

interface PipelineResult {
  meta:           ClassificationResult['meta'] & { analysisDate: string };
  billing:        ParsedBilling;
  mappings:       MappingResult;
  prices:         ClassificationResult;  // classified[] com status por provedor
  recommendation: RecommendationResult;
  payback:        PaybackResult;         // inclui migrationCostBreakdown
  multicloud:     MulticloudResult;      // etapa 7
}

type PipelineStep = 'mapping' | 'pricing' | 'classification' | 'recommendation' | 'multicloud' | 'done' | 'error';
```

---

## Estratégia de Mapeamento A+B+C (`mapping/mapping.service.ts`)

### A — Tabela estática (`pricing/sku-catalog.ts`)
Cobre ~50 instanceTypes EC2 comuns (M7g, M6i, C7g, C6i, R7g, R6i, RDS t3/m6g/r6g, ElastiCache t3/r7g/r6g). Para cada entry:
- `awsService` + `awsInstanceType`
- `gcp: { service, machineType }`
- `azure: { service, skuName, sku }`
- `oci: { service, shape, ocpu, memoryGb }`

Hit → `confidence: high`, sem chamada IA.

`extractInstanceType(specs)` extrai o instanceType do campo `specs` do serviço (ex: `"m7g.2xlarge, us-east-1, Linux"` → `"m7g.2xlarge"`).

### B — Claude com catálogo real como constraint
Serviços não resolvidos em A vão para `claude.service.ts:mapServicesWithCatalog()`.
O Claude recebe o `AvailableCatalog` gerado pelo `CatalogFetcherService`:
- GCP: lista de `machineTypes` e `services` do catálogo local
- Azure: SKUs reais da região alvo (buscados na API)
- OCI: shapes disponíveis
- AWS: lista de services suportados

Elimina SKUs inventados — o Claude só pode escolher valores da lista.

### C — Validação pós-mapeamento (`catalog/catalog-validator.service.ts`)
Verifica cada SKU mapeado pelo Claude contra os arquivos `catalogs/*.json`.
- SKU encontrado → `confidence: high` → status `verified`
- Não encontrado → mantém confidence original → `partial` (honesto: SKU não confirmado)

`partial` após C significa genuinamente que o SKU pode não existir no catálogo atual.

---

## Sistema de Catálogos Locais (`catalog/catalog-sync.service.ts`)

`OnApplicationBootstrap` — executa no startup sem bloquear o servidor.

| Catálogo | Arquivo | TTL | Fonte |
|---------|---------|-----|-------|
| OCI | `catalogs/oci.json` | 24h | `apexapps.oracle.com/pls/apex/cetools/api/v1/products/` |
| Azure | `catalogs/azure.json` | 24h | `prices.azure.com` (6 serviços × 4 regiões) |
| GCP Compute Engine | `catalogs/gcp-6F81-5844-456A.json` | 24h | Cloud Billing API |
| GCP Cloud SQL | `catalogs/gcp-9662-B51E-5089.json` | 24h | Cloud Billing API |
| GCP Cloud Storage | `catalogs/gcp-95FF-2EF5-5EA1.json` | 24h | Cloud Billing API |
| GCP Memorystore | `catalogs/gcp-E2D0-0E09-0018.json` | 24h | Cloud Billing API |
| GCP Cloud Armor | `catalogs/gcp-975A-27C5-B553.json` | 24h | Cloud Billing API |
| AWS EC2 us-east-1 | `catalogs/aws-AmazonEC2-us-east-1.json` | 24h | AWS Pricing API |
| AWS RDS us-east-1 | `catalogs/aws-AmazonRDS-us-east-1.json` | 24h | AWS Pricing API |
| … (4 serviços × 8 regiões) | | | |

Todos os pricing services leem do arquivo local primeiro; só chamam a API se o arquivo não existir ou estiver corrompido.

---

## Pricing Services

### GCP (`pricing/gcp-pricing.service.ts`)
- `fetchAllSkus()` lê de `catalogs/gcp-{serviceId}.json` (fallback: API paginada)
- `extractSearchTerms()`: termos por família de máquina (`MACHINE_FAMILY_TERMS`) ou por serviço (`SERVICE_FALLBACK_TERMS` — prioridade para Cloud Armor, Memorystore, Storage)
- Busca com região → fallback sem região

### Azure (`pricing/azure-pricing.service.ts`)
- `findInLocalCatalog()`: busca no `catalogs/azure.json` por `armSkuName` + `armRegionName`
- Fallback: 3 tentativas à API (exact → contains → sem região)

### AWS (`pricing/aws-pricing.service.ts`)
- `loadCatalog()`: lê de `catalogs/aws-{service}-{region}.json` → fallback download completo (90s)
- Cache em memória (`Map`) por `service/region` — determinístico entre chamadas
- `UNSUPPORTED_SERVICES`: WAFv2, Shield, CloudFront retornam `not_found` imediatamente (cobram por request, não têm index.json)
- Falhas não entram no cache (permite retry)

### OCI (`pricing/oci-pricing.service.ts`)
- `loadCatalog()`: lê de `catalogs/oci.json` → fallback chamada direta à API
- Flex shapes: busca dois SKUs (OCPU + memória) por família → `(ocpuPrice × ocpu) + (memPrice × memGb)`
- Fixed shapes (MySQL, Redis Cache): busca por `displayName` + `serviceCategory`

---

## Classificação de Status

```ts
resolveStatus(entry: PriceEntry, confidence: Confidence | null): VerificationStatus {
  if (!entry.verified || entry.price === null) return 'not_found';
  if (confidence === 'high') return 'verified';
  if (confidence === 'medium' || confidence === 'low') return 'partial';
  return 'verified';
}
```

`partial` após validação C = SKU mapeado pelo Claude que não foi encontrado no catálogo local.

---

## Análise Multicloud (Etapa 7)

`claude.service.ts:generateMulticloudAnalysis()` recebe preços de todos os provedores + economia do single-provider.

**Regras de domínio no prompt:**
1. Banco + cache ficam no mesmo provedor que compute
2. Storage penalizado quando compute está em provedor diferente (egress)
3. Diferença < 10% → mantém mesmo provedor (complexidade não vale)

**`MulticloudResult`:**
```ts
{
  totalEstimatedMonthlyCost: number;
  totalMonthlySaving: number;
  savingPct: number;
  coveredServices: number;
  allocations: Array<{
    service: string;
    recommendedProvider: CloudProvider;
    estimatedMonthlyCost: number;
    saving: number;
    reason: string;
  }>;
  tradeoffs: { egressCostWarning; operationalComplexity; recommendation };
  vsSingleProvider: { singleProviderSaving; multicloudExtraSaving; worthIt; justification };
}
```

Fallback sem Claude: menor preço verificado por serviço (determinístico).

---

## Payback/ROI (`pipeline.service.ts`)

```
monthlySaving = Σ (currentCost − targetPrice) para serviços verificados
migrationCost = totalCost × 3  (operação dual durante migração)
paybackMonths = ceil(migrationCost / monthlySaving)
roi(N)        = (monthlySaving × N − migrationCost) / migrationCost × 100
```

`migrationCostBreakdown: { multiplier: 3, monthlyBase, rationale }` — exposto para o frontend mostrar o cálculo.

**Savings Plans filtrados:** `SAVINGS_PLAN_PATTERN` remove linhas de desconto AWS (`savings plan`, `reserved instance`) do `topServices` — são desconto sobre EC2/RDS, não serviços independentes.

---

## Claude (`ai/claude.service.ts`)

| Método | Etapa | max_tokens | Descrição |
|--------|-------|-----------|-----------|
| `mapServices()` | 2 (legacy) | 8192 | Mapeamento sem catálogo — mantido para compatibilidade |
| `mapServicesWithCatalog()` | 2B | 8192 | Mapeamento com lista de SKUs reais como constraint |
| `generateRecommendation()` | 5 | 2048 | Melhor provedor único com justificativa CFA |
| `generateMulticloudAnalysis()` | 7 | 3000 | Alocação ótima por serviço entre os 4 provedores |

Prompt caching ativo no system prompt (`cache_control: ephemeral`) — reduz ~90% do custo em chamadas repetidas.

---

## Normalização do Input (`pipeline.service.ts:normalizeBilling`)

- Remove serviços não-técnicos: `tax`, `support`, `credits`, `refund`, `discount`
- Remove Savings Plans/Reserved Instances (`SAVINGS_PLAN_PATTERN`)
- Canonicaliza nomes genéricos (ex: `"rds"` → `"Amazon RDS"`) via `SERVICE_NAME_MAP`
- Ordena por custo e limita a top 6 serviços

---

## Cobertura (branch `feature/mapping-static-catalog`)

Bill AWS $104k/mês testado com 5 serviços:
- EC2, RDS, ElastiCache: verificados em múltiplos provedores
- S3: verificado em GCP e Azure
- AWS WAF: `not_found` (cobra por request — sem SKU por hora)

**Tabela estática:** 100% dos instanceTypes comuns → `verified` imediato
**Claude + catálogo:** cobertura de serviços sem instanceType explícito (Cloud Armor, Memorystore, Storage)
