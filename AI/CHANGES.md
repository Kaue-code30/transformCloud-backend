# Log de Mudanças — Backend

> Registra todas as mudanças feitas por sessões de IA no backend.
> Sempre adicione uma entrada no topo ao fazer alterações.

---

## [2026-06-01] — Billing: Análise Multicloud + UX Improvements + Catalog Sync

**Branch:** `feature/mapping-static-catalog`

**Objetivo:** Adicionar análise multicloud otimizada (etapa 7), sistema de catálogos locais com sync automático, e melhorias de confiabilidade/UX.

### Arquivos criados
- `src/modules/billing/catalog/catalog-sync.service.ts` — `OnApplicationBootstrap`; baixa catálogos de todas as clouds no startup, salva em `catalogs/*.json` com TTL 24h
- `src/modules/billing/catalog/catalog-validator.service.ts` — etapa C: verifica SKUs do Claude contra catálogo local; eleva `confidence: medium/low → high` quando o SKU existe
- `src/modules/billing/mapping/mapping.service.ts` — orquestra estratégia A (tabela estática) + B (Claude+catálogo) + C (validação)
- `src/modules/billing/pricing/oci-pricing.service.ts` — cliente da OCI Pricing API; Flex shapes com cálculo `(OCPU × preço) + (memória × preço)`; busca por `displayName`/`serviceCategory`
- `src/modules/billing/pricing/sku-catalog.ts` — tabela estática com ~50 instanceTypes EC2 → GCP/Azure/AWS/OCI; listas de SKUs válidos por provedor para constraint do Claude
- `src/modules/billing/pricing/catalog-fetcher.service.ts` — monta `AvailableCatalog` para etapa B
- `catalogs/.gitkeep` — diretório para catálogos gerados (arquivos .json são gitignored)

### Arquivos alterados
- `src/modules/billing/types/pipeline.types.ts`
  - Adicionados: `AwsMapping`, `MulticloudResult`, `MulticloudServiceAllocation`
  - `ServicePrice`/`ClassifiedPrice` + campos `aws: PriceEntry` e `awsStatus`
  - `PaybackResult` + `migrationCostBreakdown: { multiplier, monthlyBase, rationale }`
  - `PipelineResult` + campo `multicloud: MulticloudResult`
  - `PipelineStep` + `'multicloud'`
- `src/modules/billing/ai/claude.service.ts`
  - `mapServicesWithCatalog()` — prompt com catálogo real como constraint (B)
  - `generateMulticloudAnalysis()` — etapa 7; prompt com regras de domínio multicloud
  - `buildMulticloudPrompt()` + `fallbackMulticloud()` — cálculo determinístico sem Claude
  - Prompt de mapeamento atualizado: campos `aws.*` no schema JSON
- `src/modules/billing/pipeline.service.ts`
  - Usa `MappingService` em vez de `ClaudeService` diretamente
  - Etapa 7: `generateMulticloudAnalysis()` após payback
  - `SAVINGS_PLAN_PATTERN` — filtra Savings Plans/Reserved Instances em `normalizeBilling()`
  - `migrationCostBreakdown` exposto no `PaybackResult`
  - AWS incluído no `calculatePayback()`
- `src/modules/billing/pricing/pricing-orchestrator.service.ts`
  - Chama `OciPricingService` em paralelo (antes era `no_api` hardcoded)
  - `ociConfidence` e `ociStatus` nos resultados classificados
  - `isVerified()` e contadores incluem AWS e OCI
- `src/modules/billing/pricing/gcp-pricing.service.ts`
  - `SERVICE_FALLBACK_TERMS` — termos específicos para Cloud Armor, Memorystore, Storage (prioridade sobre `machineType`)
  - `fetchAllSkus()` lê de catálogo local primeiro
- `src/modules/billing/pricing/azure-pricing.service.ts`
  - `findInLocalCatalog()` — busca no `catalogs/azure.json` antes de chamar a API
- `src/modules/billing/pricing/aws-pricing.service.ts`
  - Substituído streaming parcial (não-determinístico) por download completo + cache em memória por `service/region`
  - `UNSUPPORTED_SERVICES` — WAFv2 retorna `not_found` imediatamente sem download
  - Falhas não entram no cache (permite retry)
  - Lê de `catalogs/aws-{service}-{region}.json` primeiro
- `src/modules/billing/billing.module.ts`
  - Registra: `OciPricingService`, `CatalogFetcherService`, `CatalogSyncService`, `CatalogValidatorService`, `MappingService`
- `.gitignore` — `catalogs/*.json` adicionado

### Por que essas mudanças

**Valores diferentes entre análises (não-determinismo):** o streaming parcial do AWS lia N bytes antes de um cap — dependendo da velocidade de rede, o produto era encontrado ou não. Solução: carregar o arquivo completo e cachear.

**OCI sempre `no_api`:** a API pública existe em `apexapps.oracle.com`. Implementado `OciPricingService` com suporte a Flex shapes (dois part numbers por shape) e fixed shapes (MySQL, Redis).

**`partial` espúrio:** Claude retornava `confidence: medium` mesmo quando o SKU existia no catálogo. A etapa C valida e eleva para `high` → `verified`.

**GCP Cloud Armor/Storage mostrando termos errados:** `extractSearchTerms` usava `machineType` como base, mas esses serviços não têm `machineType`. `SERVICE_FALLBACK_TERMS` tem prioridade.

**AWS WAF crashando cache:** a URL do WAFv2 retorna XML (404). Detectado antes do `JSON.parse`; `UNSUPPORTED_SERVICES` retorna `not_found` imediatamente.

**Savings Plans duplicando EC2:** removido em `normalizeBilling` — são descontos aplicados sobre EC2, não serviços independentes.

---

## [2026-05-22] — Billing Pipeline V2: Pipeline Completo + SSE + Melhorias de Cobertura

**Objetivo:** Completar as etapas 2, 5 e 6 do pipeline (Claude), expor endpoint SSE para o frontend, e maximizar a taxa de match nas APIs de preço.

**Arquivos criados:**
- `src/modules/billing/ai/claude.service.ts`
- `src/modules/billing/pipeline.service.ts`
- `src/modules/billing/billing.controller.ts`

**Arquivos alterados:**
- `billing.module.ts`, `pipeline.types.ts`, `azure-pricing.service.ts`, `gcp-pricing.service.ts`

**Resultado:** Pipeline funcional de 6 etapas, 67% de cobertura em bill real de $104k/mês.

---

## [2026-05-21] — Users: Troca de Senha com Validação da Senha Atual

**Arquivos criados:** `src/modules/users/dto/change-password.dto.ts`
**Arquivos alterados:** `users.service.ts`, `users.controller.ts`

---

## [2026-05-21] — Auth: Endpoints de Recuperação de Senha

**Arquivos criados:** `forgot-password.dto.ts`, `reset-password.dto.ts`
**Arquivos alterados:** `auth.service.ts`, `auth.controller.ts`

---

## [2026-05-21] — Billing Pipeline V2: Etapas 3 e 4 (APIs de Preços)

**Arquivos criados:** `pipeline.types.ts`, `azure-pricing.service.ts`, `aws-pricing.service.ts`, `gcp-pricing.service.ts`, `pricing-orchestrator.service.ts`

---

## [2026-05-21] — Setup Inicial do Backend

**Descrição:** Projeto NestJS com Auth JWT completo, Users, Prisma 7, PostgreSQL.
