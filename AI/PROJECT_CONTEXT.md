# TransformCloud Backend — Contexto Completo

> Atualizado em: 2026-05-22
> Objetivo: Referência para agentes de IA e desenvolvedores antes de qualquer mudança no backend.

---

## O que é este backend?

API REST em NestJS que serve o frontend Next.js do TransformCloud. Roda na porta **3001** enquanto o Next.js roda na **3000**.

**Responsabilidades:** autenticação JWT, perfil de usuário, pipeline de análise de billing V2 (funcional).

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
├── main.ts                         # Porta 3001, CORS :3000, ValidationPipe global
├── app.module.ts                   # Raiz: registra todos os módulos
├── prisma/
│   ├── prisma.service.ts           # PrismaClient global
│   └── prisma.module.ts
└── modules/
    ├── auth/                       # Auth JWT completo (register, login, refresh, logout, forgot/reset password)
    ├── users/                      # Perfil de usuário protegido por JWT
    └── billing/                    # Pipeline V2 — FUNCIONAL
        ├── billing.module.ts       # Registra todos os providers + controller
        ├── billing.controller.ts   # POST /api/billing/analyze/stream (SSE)
        ├── pipeline.service.ts     # Orquestra as 6 etapas, emite Observable SSE
        ├── ai/
        │   └── claude.service.ts   # Etapas 2 e 5 (mapeamento + recomendação via Claude Opus 4.7)
        ├── pricing/
        │   ├── azure-pricing.service.ts       # Azure Retail Prices API
        │   ├── gcp-pricing.service.ts         # GCP Cloud Billing API
        │   ├── aws-pricing.service.ts         # AWS Pricing API (bulk JSON)
        │   └── pricing-orchestrator.service.ts # Etapas 3+4: chamadas paralelas + classificação
        └── types/
            └── pipeline.types.ts   # Todos os tipos TypeScript do pipeline
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

# IA
ANTHROPIC_API_KEY=sk-ant-...   # Claude Opus 4.7 — etapas 2 e 5 do pipeline

# GCP (opcional — aumenta cobertura de preços)
GCP_API_KEY=AIzaSy...          # Cloud Billing API — sem OAuth, sem custo
                                # Criar em: console.cloud.google.com/apis/credentials
                                # Habilitar: Cloud Billing API
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
| POST | `/forgot-password` | Inicia recuperação (resposta neutra) |
| POST | `/reset-password` | Redefine senha via token temporário |

### Users — `/api/users`
| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/me` | JWT | Retorna perfil |
| PATCH | `/me` | JWT | Atualiza nome |
| PATCH | `/me/password` | JWT | Troca senha com validação da atual |

### Billing — `/api/billing`
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/analyze/stream` | Pipeline completo via SSE — recebe `ParsedBilling`, retorna eventos de progresso + resultado |

---

## Pipeline de Billing V2

### Endpoint

```
POST /api/billing/analyze/stream
Content-Type: application/json
```

### Body: `ParsedBilling`

```ts
{
  provider: 'AWS' | 'GCP' | 'AZURE' | 'OCI';
  period: { start: string; end: string };  // ISO: "2026-03-01"
  currency: string;        // "USD"
  totalCost: number;
  dataQuality: 'good' | 'partial' | 'poor';
  topServices: Array<{
    name: string;          // "Amazon EC2"
    specs: string;         // "m7g.2xlarge, us-east-1, Linux, On-Demand"
    cost: number;
    pct: number;
    quantity: string;      // "730 horas" ou "18454 instance-hours"
  }>;
  targetRegion?: string;   // Opcional — "Brasil", "us-east-1", "Europa"
                           // Quando informado, aumenta significativamente o match nas APIs de preço
                           // Instrui Claude a usar regiões geográficas equivalentes nos provedores destino
}
```

### Eventos SSE emitidos

| `step` | Quando | `data` |
|--------|--------|--------|
| `mapping` (×2) | Início + fim do mapeamento Claude | 2ª: `{ mappings }` |
| `pricing` | Antes de buscar preços | — |
| `classification` | Preços + classificação prontos | `{ prices }` |
| `recommendation` (×2) | Início + fim da recomendação Claude | 2ª: `{ recommendation }` |
| `done` | Pipeline completo | `PipelineResult` completo |
| `error` | Qualquer erro | `{ message }` |

### Etapas do Pipeline

| Etapa | Responsável | Implementação |
|-------|-------------|---------------|
| 1. Parsing | Frontend | Frontend parseia o arquivo e envia `ParsedBilling` |
| 2. Mapeamento | Claude Opus 4.7 | `claude.service.ts` — mapeia serviços para GCP/Azure/OCI equivalentes |
| 3. Preços reais | APIs públicas | `pricing-orchestrator.service.ts` — chamadas paralelas |
| 4. Classificação | Código | `verified` / `partial` / `not_found` / `no_api` |
| 5. Recomendação | Claude Opus 4.7 | `claude.service.ts` — recomendação com base nos dados verificados |
| 6. Payback/ROI | Código | `pipeline.service.ts` — cálculo de 12/24/36 meses |

### APIs de Preço

| Provedor | API | Auth | Notas |
|----------|-----|------|-------|
| **Azure** | prices.azure.com/api/retail/prices | Nenhuma | Busca com 3 tentativas: exact SKU → contains SKU → sem região |
| **GCP** | cloudbilling.googleapis.com | `GCP_API_KEY` | Paginação completa (até 5 páginas × 5000 SKUs); ~25 famílias de máquina mapeadas |
| **AWS** | pricing.us-east-1.amazonaws.com | Nenhuma | Arquivo JSON bulk (~100MB EC2); timeout 15s |
| **OCI** | — | — | Sem API pública; sempre retorna `no_api` |

### Cobertura atual

Testado com bill real AWS de $104k/mês (5 serviços):
- **4/5 serviços verificados** → cobertura de **67%** do custo
- EC2, RDS, S3, ElastiCache: verificados em Azure ou GCP
- AWS WAF: sem match (WAF_v2 usa LCU, não SKU de VM)

### Claude — configuração

- Modelo: `claude-opus-4-7`
- Prompt caching ativo no system prompt (ephemeral) — reduz ~90% do custo em chamadas repetidas
- Etapa 2 (mapeamento): `max_tokens: 4096`
- Etapa 5 (recomendação): `max_tokens: 2048`
- `safeParseJson()` extrai JSON mesmo se Claude envolver em markdown

---

## Status dos Módulos

| Módulo | Status |
|--------|--------|
| `auth` | ✅ Completo |
| `users` | ✅ Completo |
| `billing` | ✅ Pipeline V2 funcional (67% cobertura) |
| `migrations` | 🔲 Scaffold vazio |
| `observability` | 🔲 Scaffold vazio |
| `integrations` | 🔲 Scaffold vazio |

---

## Próximas melhorias — Billing

1. **`estimatedMonthly` correto**: parsear `quantity` do serviço (ex: `"18.454 instance-hours"`) para usar horas reais em vez de 730h fixo
2. **Azure WAF/Blob**: mudar query para filtrar por `meterName` em vez de `armSkuName` (esses serviços cobram por LCU/GB)
3. **Cobertura GCP**: service IDs de mais serviços (Memorystore ID ainda não verificado)
4. **`migrationCost` configurável**: atualmente é `totalCost × 3` (heurística); expor como parâmetro
5. **Cache de SKUs**: os catálogos GCP/Azure não mudam com frequência — cachear por 24h em Redis

---

## Como Rodar Localmente

```bash
cd backend
npm install
cp .env.example .env   # ajustar DATABASE_URL e ANTHROPIC_API_KEY
docker-compose up -d   # PostgreSQL
npx prisma migrate dev
npm run start:dev       # porta 3001
```
