# TransformCloud Backend — Contexto Completo

> Atualizado em: 2026-06-01
> Objetivo: Referência para agentes de IA e desenvolvedores antes de qualquer mudança no backend.

---

## O que é este backend?

API REST em NestJS que serve o frontend Next.js do TransformCloud. Roda na porta **3001** enquanto o Next.js roda na **3000**.

**Responsabilidades:** autenticação JWT, perfil de usuário, pipeline de análise de billing V2 com 7 etapas incluindo análise multicloud.

---

## Stack Técnica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Framework | NestJS | 11.x |
| Linguagem | TypeScript | 5.x |
| ORM | Prisma | 7.8.0 |
| Banco | PostgreSQL | 16 |
| Auth | Passport + JWT | - |
| Validação | class-validator + class-transformer | - |
| IA | @anthropic-ai/sdk | latest |

**Atenção Prisma 7:** `url` removido do `schema.prisma` — fica em `prisma.config.ts`. Requer `@prisma/adapter-pg` no construtor do `PrismaService`.

---

## Estrutura de Arquivos

```
src/
├── main.ts
├── app.module.ts
├── prisma/
│   ├── prisma.service.ts
│   └── prisma.module.ts
└── modules/
    ├── auth/                          # Auth JWT completo
    ├── users/                         # Perfil de usuário
    └── billing/
        ├── billing.module.ts
        ├── billing.controller.ts      # POST /api/billing/analyze/stream (SSE)
        ├── pipeline.service.ts        # Orquestra as 7 etapas
        ├── ai/
        │   └── claude.service.ts      # Etapas 2, 5, 7 — Claude com prompt caching
        ├── catalog/
        │   ├── catalog-sync.service.ts     # OnApplicationBootstrap — sincroniza catálogos
        │   └── catalog-validator.service.ts # Valida SKUs mapeados contra catálogo local
        ├── mapping/
        │   └── mapping.service.ts     # Estratégia A+B+C de mapeamento
        ├── pricing/
        │   ├── azure-pricing.service.ts
        │   ├── gcp-pricing.service.ts
        │   ├── aws-pricing.service.ts
        │   ├── oci-pricing.service.ts
        │   ├── pricing-orchestrator.service.ts
        │   ├── catalog-fetcher.service.ts
        │   └── sku-catalog.ts         # Tabela estática ~50 instanceTypes
        └── types/
            └── pipeline.types.ts

catalogs/                              # Gerado no startup — gitignored
├── oci.json
├── azure.json
├── gcp-{serviceId}.json
└── aws-{service}-{region}.json
```

---

## Variáveis de Ambiente (`.env`)

```env
DATABASE_URL="postgresql://postgres:<senha>@localhost:5432/transformcloud"
JWT_SECRET="..."
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="..."
JWT_REFRESH_EXPIRES_IN="7d"
PORT=3001

ANTHROPIC_API_KEY=sk-ant-...   # Claude — etapas 2, 5, 7 do pipeline

# GCP (obrigatório para preços GCP)
GCP_API_KEY=AIzaSy...          # Cloud Billing API — sem OAuth
```

---

## Endpoints Implementados

Prefixo global: `/api`

### Auth — `/api/auth`
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/register` | Cadastro + retorna tokens |
| POST | `/login` | Login + retorna tokens |
| POST | `/refresh` | Renova tokens (rotação) |
| POST | `/logout` | Invalida refresh token |
| POST | `/forgot-password` | Inicia recuperação |
| POST | `/reset-password` | Redefine senha via token |

### Users — `/api/users`
| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/me` | JWT | Retorna perfil |
| PATCH | `/me` | JWT | Atualiza nome |
| PATCH | `/me/password` | JWT | Troca senha com validação da atual |

### Billing — `/api/billing`
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/analyze/stream` | Pipeline completo via SSE |

---

## Pipeline de Billing V2 — 7 Etapas

```
Frontend (parse) → POST /api/billing/analyze/stream

[1] normalizeBilling   — remove Tax/Support/SavingsPlans, canonicaliza nomes, limita top 6
[2] Mapeamento A+B+C   — tabela estática → Claude com catálogo → validação vs catálogo local
[3] Preços reais       — 4 provedores em paralelo: GCP, Azure, AWS, OCI
[4] Classificação      — verified / partial / not_found / no_api
[5] Recomendação       — Claude Opus: melhor provedor único
[6] Payback/ROI        — código: 12/24/36 meses + breakdown do custo de migração
[7] Multicloud         — Claude Opus: alocação ótima por serviço entre os 4 provedores
    ↓ SSE events → frontend
```

### Eventos SSE emitidos

| `step` | `data` |
|--------|--------|
| `mapping` (×2) | 2ª: `{ mappings }` |
| `pricing` | — |
| `classification` | `{ prices }` |
| `recommendation` (×2) | 2ª: `{ recommendation }` |
| `multicloud` | — |
| `done` | `PipelineResult` completo |
| `error` | `{ message }` |

### Body de entrada: `ParsedBilling`

```ts
{
  provider: 'AWS' | 'GCP' | 'AZURE' | 'OCI';
  period: { start: string; end: string };
  currency: string;
  totalCost: number;
  dataQuality: 'good' | 'partial' | 'poor';
  topServices: Array<{
    name: string;     // "Amazon EC2"
    specs: string;    // "m7g.2xlarge, us-east-1, Linux, On-Demand"
    cost: number;
    pct: number;
    quantity: string; // "730 horas"
  }>;
  targetRegion?: string; // "Brasil" | "us-east-1" | "Europa" — aumenta match nas APIs
}
```

### Resposta final: `PipelineResult`

```ts
{
  meta:           { analyzedServices, verifiedServices, partialServices, notFoundServices, coveredCostPct, analysisDate }
  billing:        ParsedBilling
  mappings:       MappingResult
  prices:         ClassificationResult   // classified[] com gcpStatus/azureStatus/awsStatus/ociStatus
  recommendation: RecommendationResult
  payback:        PaybackResult          // inclui migrationCostBreakdown
  multicloud:     MulticloudResult       // alocação ótima + tradeoffs + vsSingleProvider
}
```

---

## Sistema de Catálogos Locais

`CatalogSyncService` implementa `OnApplicationBootstrap` — roda automaticamente no startup, baixa e salva os catálogos em `catalogs/*.json` (TTL 24h, gitignored).

| Arquivo | Fonte | Conteúdo |
|---------|-------|---------|
| `oci.json` | apexapps.oracle.com/pls/apex/cetools/api/v1/products/ | ~643 produtos completos |
| `azure.json` | prices.azure.com/api/retail/prices | 6 serviços × 4 regiões |
| `gcp-{id}.json` | cloudbilling.googleapis.com | SKUs por serviço (até 25k) |
| `aws-{svc}-{region}.json` | pricing.us-east-1.amazonaws.com | Produtos filtrados por serviço+região |

Os pricing services leem do arquivo local primeiro e só chamam a API se o arquivo não existir (fallback).

---

## Estratégia de Mapeamento A+B+C

**A — Tabela estática** (`sku-catalog.ts`)
- ~50 instanceTypes EC2 comuns → GCP + Azure + AWS + OCI com `confidence: high`
- Zero chamada IA; determinístico

**B — Claude com catálogo real como constraint** (`claude.service.ts:mapServicesWithCatalog`)
- Serviços não encontrados em A vão para Claude
- Claude recebe lista real de SKUs disponíveis (do catálogo local) como constraint
- Elimina SKUs inventados

**C — Validação pós-mapeamento** (`catalog-validator.service.ts`)
- Cada SKU mapeado pelo Claude é verificado contra o catálogo local
- Se o SKU existe → `confidence: high` → status `verified`
- Resultado: `partial` só aparece quando o SKU genuinamente não está no catálogo

---

## APIs de Preço

| Provedor | API | Auth | Estratégia |
|----------|-----|------|-----------|
| **Azure** | prices.azure.com/api/retail/prices | Nenhuma | Cache local → fallback API; 3 tentativas (exact → contains → sem região) |
| **GCP** | cloudbilling.googleapis.com | `GCP_API_KEY` | Cache local → fallback paginado (até 5 páginas × 5000 SKUs) |
| **AWS** | pricing.us-east-1.amazonaws.com | Nenhuma | Cache local → fallback download completo (90s timeout); cache em memória por service+region |
| **OCI** | apexapps.oracle.com/pls/apex/cetools/api/v1/products/ | Nenhuma | Cache local → fallback API; Flex shapes: (OCPU × preço) + (GB × preço) |

---

## Análise Multicloud (Etapa 7)

Claude recebe os preços verificados de todos os provedores e aplica regras de domínio:
- Banco de dados e cache ficam no mesmo provedor que compute
- Storage penalizado se compute vai para outro provedor (egress)
- Diferença < 10% entre melhor e segundo → mantém mesmo provedor

Retorna `MulticloudResult` com:
- `allocations[]` — provedor ótimo por serviço com justificativa
- `tradeoffs` — egress, complexidade operacional, recomendação
- `vsSingleProvider` — economia extra vs single-provider + veredicto

Fallback determinístico sem Claude: menor preço verificado por serviço.

---

## Payback/ROI

```
monthlySaving   = Σ (currentCost − targetPrice) para serviços verificados no provedor recomendado
migrationCost   = totalCost × 3  (3 meses de operação dual)
paybackMonths   = ceil(migrationCost / monthlySaving)
roi(N)          = (monthlySaving × N − migrationCost) / migrationCost × 100
```

`migrationCostBreakdown` expõe `multiplier`, `monthlyBase` e `rationale` para o frontend exibir o cálculo.

---

## Status dos Módulos

| Módulo | Status |
|--------|--------|
| `auth` | ✅ Completo |
| `users` | ✅ Completo |
| `billing` | ✅ Pipeline V2 funcional — 7 etapas, 4 provedores, catálogo local |

---

## Como Rodar Localmente

```bash
npm install
cp .env.example .env   # ajustar DATABASE_URL, ANTHROPIC_API_KEY, GCP_API_KEY
docker-compose up -d   # PostgreSQL
npx prisma migrate dev
npm run start:dev       # porta 3001
# Na primeira inicialização o CatalogSyncService baixa os catálogos (~2-3 min)
```
