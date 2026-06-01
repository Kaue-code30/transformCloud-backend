# Módulo: Billing — Pipeline V2

> Atualizado em: 2026-05-22
> Status: Funcional — 67% de cobertura verificada em bill real de $104k/mês

---

## Visão Geral

Pipeline de análise de billing em 6 etapas. O frontend parseia o arquivo e envia o resultado estruturado; o backend orquestra mapeamento IA + APIs de preço + recomendação IA.

```
Frontend (parse)
    ↓ POST /api/billing/analyze/stream
[1] ParsedBilling recebido
[2] Claude Opus 4.7 — mapeia serviços AWS → GCP/Azure/OCI
[3] APIs públicas — busca preços reais em paralelo
[4] Classificação — verified / partial / not_found / no_api
[5] Claude Opus 4.7 — recomendação baseada nos dados verificados
[6] Código — payback e ROI (12/24/36 meses)
    ↓ SSE events → frontend
```

---

## Arquivos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `billing.controller.ts` | `POST /analyze/stream` — escreve SSE manualmente via `@Res()` |
| `pipeline.service.ts` | Orquestra as 6 etapas, retorna `Observable<PipelineProgressEvent>` |
| `ai/claude.service.ts` | Etapas 2 e 5 — chamadas ao Claude com prompt caching |
| `pricing/pricing-orchestrator.service.ts` | Etapas 3+4 — chamadas paralelas + classificação |
| `pricing/azure-pricing.service.ts` | Azure Retail Prices API |
| `pricing/gcp-pricing.service.ts` | GCP Cloud Billing API |
| `pricing/aws-pricing.service.ts` | AWS Pricing API (bulk JSON) |
| `types/pipeline.types.ts` | Todos os tipos TypeScript do pipeline |

---

## Tipos principais (`pipeline.types.ts`)

```ts
// Input do frontend
interface ParsedBilling {
  provider: 'AWS' | 'GCP' | 'AZURE' | 'OCI';
  period: { start: string; end: string };
  currency: string;
  totalCost: number;
  dataQuality: 'good' | 'partial' | 'poor';
  topServices: TopService[];
  targetRegion?: string;  // "Brasil", "us-east-1", "Europa" — aumenta cobertura
}

// Evento SSE
interface PipelineProgressEvent {
  step: 'mapping' | 'pricing' | 'classification' | 'recommendation' | 'done' | 'error';
  message: string;
  data?: Partial<PipelineResult>;
}

// Resposta final (no evento 'done')
interface PipelineResult {
  meta: ClassificationResult['meta'] & { analysisDate: string };
  billing: ParsedBilling;
  mappings: MappingResult;
  prices: ClassificationResult;
  recommendation: RecommendationResult;
  payback: PaybackResult;
}
```

---

## SSE: por que `@Post` em vez de `@Sse`

O decorator `@Sse` do NestJS cria um endpoint **GET**, que não aceita body. Como o frontend precisa enviar `ParsedBilling` no body, usamos `@Post` com `@Res()` e escrevemos o stream SSE manualmente:

```ts
@Post('analyze/stream')
analyzeStream(@Body() billing: ParsedBilling, @Res() res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sub = this.pipeline.runStream(billing).subscribe({
    next: (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
    complete: () => res.end(),
    error: (err) => { /* write error event */ res.end(); },
  });

  res.on('close', () => sub.unsubscribe());
}
```

O frontend consome com `fetch` + `ReadableStream` (não `EventSource`, que só suporta GET).

---

## Claude (`ai/claude.service.ts`)

### Configuração
- Modelo: `claude-opus-4-7`
- Prompt caching: `cache_control: { type: 'ephemeral' }` no system prompt — reduz ~90% do custo de tokens de entrada em chamadas repetidas

### `mapServices()` — Etapa 2
Recebe `ParsedBilling`, monta prompt com:
- Lista de serviços com specs
- Tabela de equivalência de regiões AWS ↔ GCP ↔ Azure
- Restrição geográfica se `targetRegion` presente
- Lista fechada de valores válidos para `gcp.service` e `azure.service` — evita nomes compostos que quebram o parser GCP

### `generateRecommendation()` — Etapa 5
Recebe billing + resultado dos preços classificados. Monta prompt com resumo do comparativo verificado.

### `safeParseJson<T>()`
Extrai o primeiro bloco `{...}` da resposta mesmo se Claude envolver em markdown.

---

## GCP (`pricing/gcp-pricing.service.ts`)

### Serviços mapeados
```ts
const GCP_SERVICE_IDS = {
  'Compute Engine': '6F81-5844-456A',
  'Cloud SQL':      '9662-B51E-5089',
  'Cloud Storage':  '95FF-2EF5-5EA1',
  'Cloud Run':      '152E-C115-5142',
  'BigQuery':       '24E6-581D-38E5',
  'Memorystore':    'E2D0-0E09-0018',
  'AlloyDB':        '9BAE-B4E0-5BF3',
  'Cloud Armor':    '975A-27C5-B553',
};
```

### Estratégia de busca
1. `resolveServiceId()` — match exato → prefixo → contains (aceita `"Cloud SQL for MySQL"`)
2. `extractSearchTerms()` — tabela `MACHINE_FAMILY_TERMS` com ~25 famílias; para `t2d-standard-8` gera `["tau t2d amd instance core"]`
3. `fetchAllSkus()` — segue `nextPageToken` até 5 páginas (Compute Engine tem >10k SKUs)
4. Para cada termo candidato: busca com região → sem região (fallback)

### `node:https` em vez de `fetch`
`fetch` nativo do Node.js tem comportamento instável no Windows para requests externas longas. `node:https` com timeout manual é mais confiável.

---

## Azure (`pricing/azure-pricing.service.ts`)

### Estratégia de busca (3 tentativas sequenciais)
1. `armSkuName eq 'SKU'` + região + `priceType eq 'Consumption'`
2. `contains(armSkuName,'SKU')` + região + Consumption
3. `contains(armSkuName,'SKU')` sem região (fallback global)

### `SERVICES_WITH_CONTAINS`
Serviços que usam `contains` desde a primeira tentativa (Azure Cache for Redis, Azure Blob Storage, PostgreSQL/MySQL Flexible Server) porque o SKU do catálogo tem variações de sufixo.

### Limitação conhecida
**Azure WAF (`WAF_v2`) e Blob Storage** não são encontrados por `armSkuName` — cobram por LCU e GB/mês, o filtro correto seria por `meterName`. Pendente de implementação.

---

## Cálculo de Payback (`pipeline.service.ts`)

```
monthlySaving = Σ (currentCost - targetPrice) para serviços verificados
migrationCost = totalCost × 3  ← heurística conservadora
paybackMonths = ceil(migrationCost / monthlySaving)
roi(N) = (monthlySaving × N - migrationCost) / migrationCost × 100
```

**Limitação atual:** `estimatedMonthly` usa `preço_unitário × 730h` fixo. Para bills com centenas de instâncias o `monthlySaving` fica subestimado. Melhorar parseando `quantity` (ex: `"18.454 instance-hours"`).

---

## `targetRegion` — campo opcional no input

Quando informado, o Claude usa a tabela de equivalência de regiões embutida no prompt:

| AWS | GCP | Azure |
|-----|-----|-------|
| us-east-1 | us-east4 | eastus |
| sa-east-1 | southamerica-east1 | brazilsouth |
| eu-west-1 | europe-west1 | westeurope |
| eu-central-1 | europe-west3 | germanywestcentral |
| ap-southeast-1 | asia-southeast1 | southeastasia |

Regiões com catálogo completo (`us-east4`, `eastus`) têm maior taxa de match.

---

## Cobertura atual (bill AWS $104k/mês, 5 serviços)

| Serviço | Azure | GCP | Pendência |
|---------|-------|-----|-----------|
| Amazon EC2 | ✅ | ❌ | GCP: t2d não encontrado em us-east4 |
| Amazon RDS | ✅ | ❌ | GCP: db-custom-64 não encontrado |
| Amazon S3 | ❌ | ✅ | Azure: Blob usa meterName, não armSkuName |
| Amazon ElastiCache | ✅ | ❌ | GCP: Memorystore service ID pendente de verificação |
| AWS WAF | ❌ | ❌ | Ambos usam request/LCU, não SKU de VM |

**4/5 serviços → 67% de cobertura de custo**

---

## Próximas melhorias

1. `estimatedMonthly` correto — parsear `quantity` do serviço para horas reais
2. Azure WAF/Blob — filtrar por `meterName` em vez de `armSkuName`
3. GCP Memorystore — verificar service ID correto
4. `migrationCost` configurável — expor como parâmetro no input
5. Cache de catálogos GCP/Azure — TTL 24h para não recarregar a cada request
