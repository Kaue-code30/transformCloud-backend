# Módulo: Billing

> Última atualização: 2026-05-21
> Status: Parcialmente implementado — Etapas 3 e 4 prontas

---

## Responsabilidade

Análise de custos de cloud via pipeline em 6 etapas (V2). Recebe um arquivo de billing do provedor atual, mapeia serviços equivalentes nos outros provedores, busca preços reais via APIs públicas e gera recomendação de migração com cálculo de payback.

Arquitetura completa documentada em: `AI/ARCHITECTURE_BILLING_V2.md`

---

## Arquivos

```
src/modules/billing/
├── billing.module.ts                        # Registra e exporta os providers de pricing
├── types/
│   └── pipeline.types.ts                    # Tipos TypeScript de todas as 6 etapas
└── pricing/
    ├── azure-pricing.service.ts             # Cliente Azure Retail Prices API
    ├── aws-pricing.service.ts               # Cliente AWS Pricing API
    ├── gcp-pricing.service.ts               # Cliente GCP Cloud Billing API
    └── pricing-orchestrator.service.ts      # Orquestra Etapas 3 + 4
```

---

## Status por Etapa do Pipeline

| Etapa | Responsável | Status | Arquivo |
|-------|-------------|--------|---------|
| 1 — Parsing e análise inicial | Código | ❌ Pendente | — |
| 2 — Mapeamento de serviços | Claude (1ª chamada) | ❌ Pendente | — |
| 3 — Busca de preços reais | Código → APIs públicas | ✅ Implementado | `pricing/*.service.ts` |
| 4 — Classificação de confiança | Código | ✅ Implementado | `pricing-orchestrator.service.ts` |
| 5 — Recomendação e texto | Claude (2ª chamada) | ❌ Pendente | — |
| 6 — Cálculo de PAYBACK | Código | ❌ Pendente | — |

---

## Etapa 3 — Clientes de API de Preços

### Azure (`AzurePricingService`)

- **API:** `https://prices.azure.com/api/retail/prices`
- **Auth:** Nenhuma — API pública
- **Entrada:** `AzureMapping` (skuName, service, region) + quantidade de horas
- **Filtra por:** `serviceName`, `armSkuName`, `armRegionName`, `priceType eq 'Consumption'`
- **Timeout:** 8 segundos
- **Retorna:** `PriceEntry` com `price` (por hora), `estimatedMonthly`, `source`

### AWS (`AwsPricingService`)

- **API:** `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/{service}/current/{region}/index.json`
- **Auth:** Nenhuma — API pública
- **Entrada:** `AwsPricingParams` (service, region, instanceType, operatingSystem) + horas
- **Estratégia:** Baixa o `index.json` da região e filtra por `instanceType` + `operatingSystem=Linux` + `tenancy=Shared`
- **Timeout:** 15 segundos (arquivo grande)
- **Mapa de regiões:** `us-east-1` → `"US East (N. Virginia)"` etc. (ver `AWS_REGION_NAMES` no serviço)
- **Retorna:** `PriceEntry` com preço OnDemand por hora

### GCP (`GcpPricingService`)

- **API:** `https://cloudbilling.googleapis.com/v1/services/{serviceId}/skus`
- **Auth:** Requer `GCP_API_KEY` no `.env` (chave de API pública do Google Cloud, sem OAuth)
- **Entrada:** `GcpMapping` (service, machineType/tier, region) + horas
- **Estratégia:** Busca SKUs do serviço e filtra por descrição + região
- **IDs de serviço mapeados:**
  - Compute Engine: `6F81-5844-456A`
  - Cloud SQL: `9662-B51E-5089`
  - Cloud Storage: `95FF-2EF5-5EA1`
  - Cloud Run: `152E-C115-5142`
  - BigQuery: `24E6-581D-38E5`
- **Formato de preço:** `units + nanos/1e9` (padrão Google)
- **Retorna:** `PriceEntry` com preço por hora

### OCI

Sem API pública disponível. Sempre retorna `{ price: null, verified: false, reason: "API pública não disponível para OCI" }`.

---

## Etapa 4 — Classificação de Confiança (`PricingOrchestratorService`)

Método principal: `fetchPrices(billing, mappings): Promise<ClassificationResult>`

### Lógica de status por serviço

| Status | Critério |
|--------|----------|
| `verified` | `verified: true` na API **e** `confidence: 'high'` no mapeamento Claude |
| `partial` | `verified: true` na API **mas** `confidence: 'medium'` ou `'low'` |
| `not_found` | `verified: false` — API não retornou resultado |
| `no_api` | OCI — hardcoded, sem API disponível |

### Meta calculada

- `verifiedServices` — qtd de serviços com ao menos um provedor `verified`
- `coveredCostPct` — `(custo dos serviços verificados / custo total) * 100`

---

## Tipos Compartilhados (`pipeline.types.ts`)

Todos os tipos das 6 etapas estão centralizados aqui. Interfaces principais:

| Tipo | Usado na etapa |
|------|---------------|
| `ParsedBilling` | 1 — saída do parser |
| `TopService` | 1 — cada serviço extraído |
| `ServiceMapping`, `MappingResult` | 2 — retorno do Claude |
| `PriceEntry`, `ServicePrice`, `PricingResult` | 3 — preços brutos |
| `ClassifiedPrice`, `ClassificationResult` | 4 — após classificação |
| `RecommendationResult` | 5 — retorno do Claude |
| `PaybackResult` | 6 — cálculo matemático |
| `PipelineResult` | Final — resposta consolidada |

---

## Variáveis de Ambiente Necessárias

```env
GCP_API_KEY=           # Chave de API pública do Google Cloud (sem OAuth)
                       # Criar em: console.cloud.google.com → APIs & Services → Credentials
                       # Habilitar: Cloud Billing API
```

As APIs da Azure e da AWS são públicas e não requerem credenciais.

---

## Como Usar em Outros Serviços

```typescript
import { PricingOrchestratorService } from '../billing/pricing/pricing-orchestrator.service';

// No construtor:
constructor(private readonly pricing: PricingOrchestratorService) {}

// Uso:
const classification = await this.pricing.fetchPrices(parsedBilling, mappingResult);
// classification.classified — lista de serviços com preços e status
// classification.meta — resumo: verified/partial/notFound/coveredCostPct
```

O `BillingModule` exporta `PricingOrchestratorService`. Importe `BillingModule` no módulo que precisar.

---

## Próximos Passos

- [ ] Etapa 1 — `BillingParserService`: parser CSV/JSON/TXT, detecção de provedor, extração de top serviços
- [ ] Etapa 2 — `MappingService`: prompt Claude para mapear serviços entre provedores
- [ ] Etapa 5 — `RecommendationService`: prompt Claude com dados verificados
- [ ] Etapa 6 — `PaybackService`: cálculo de ROI/payback (matemática pura)
- [ ] `BillingController`: `POST /billing/analyze` (upload de arquivo), `GET /billing/analyses`, `GET /billing/analyses/:id`
- [ ] `BillingAnalysis` DTO para request/response
- [ ] Persistência no banco via `PrismaService` (model `BillingAnalysis` já existe no schema)