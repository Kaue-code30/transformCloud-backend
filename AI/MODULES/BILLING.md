# Módulo: Billing — Pipeline determinístico

> Atualizado em: 2026-09-25
> Status: fluxo ponta a ponta validado para seis tipos de serviço

## Visão geral

O frontend transforma o arquivo de billing em linhas nativas (`lineItems`) e envia o contrato estruturado ao backend. A partir daí, mapeamento, preço, classificação, ranking e payback são calculados por código usando o catálogo local versionado.

```text
Arquivo do provedor
  -> parser determinístico do frontend
  -> POST /api/billing/analyze/stream
  -> normalização das linhas
  -> matching pelo catálogo
  -> preço pelos medidores e tiers vigentes
  -> classificação e ranking por código
  -> redação opcional pela IA
  -> eventos SSE para o frontend
```

A IA não escolhe SKUs, equivalências, regiões, valores ou o provedor recomendado. Sem `ANTHROPIC_API_KEY`, o resultado continua completo e a explicação usa texto determinístico.

## Contrato de entrada

```ts
interface ParsedBilling {
  provider: 'AWS' | 'GCP' | 'AZURE' | 'OCI';
  period: { start: string; end: string };
  currency: string;
  totalCost: number;
  dataQuality: 'good' | 'partial' | 'poor';
  targetRegion?: string;
  topServices: TopService[]; // compatibilidade temporária
  lineItems?: BillingLineItem[];
}

interface BillingLineItem {
  sourceKey?: string;
  provider: 'AWS' | 'GCP' | 'AZURE' | 'OCI';
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
```

`lineItems` é o formato preferencial. O backend deriva `topServices` dessas linhas, ordena por custo e analisa até 25 itens técnicos. Identificadores nativos devem ser preservados; não devem ser inferidos pela IA.

## Endpoint e SSE

```http
POST /api/billing/analyze/stream
Content-Type: application/json
Accept: text/event-stream
```

Como a chamada precisa de body, o endpoint usa `POST` e escreve SSE manualmente. No navegador, o consumo deve ser feito com `fetch` e `ReadableStream`, não com `EventSource`.

| `step` | Significado | Conteúdo relevante |
|---|---|---|
| `mapping` | início e resultado do matching | `data.mappings` no segundo evento |
| `pricing` | início do cálculo de preços | mensagem de progresso |
| `classification` | valores e cobertura calculados | `data.prices` |
| `recommendation` | decisão/ranking calculado | `data.recommendation` no segundo evento |
| `done` | resultado consolidado | `data` contém `PipelineResult` completo |
| `error` | falha durante o pipeline | `message` |

O status HTTP já foi enviado quando o stream começa. Por isso, erros ocorridos durante o pipeline são comunicados como evento `error`.

## Etapas e responsabilidades

| Etapa | Responsável | Regra |
|---|---|---|
| Parsing | frontend | lê campos conhecidos de CSV/JSON e preserva IDs nativos |
| Normalização | backend | filtra itens não técnicos e agrega o formato de análise |
| Mapeamento | `DeterministicMappingService` | override aprovado, capacidade compatível ou mesmo `resourceKind` no catálogo |
| Preço | `CatalogPricingService` | medidores, multiplicadores, vigência e tiers locais |
| Classificação | `PricingOrchestratorService` | `verified`, `partial`, `not_found` ou `no_api` |
| Recomendação | código | menor custo projetado somente sobre itens verificados |
| Redação | Claude opcional | explica a decisão sem poder alterá-la |
| Payback | código | economia, custo de migração e ROI |

## Regras de transparência para o frontend

- Mostrar valor somente quando `estimatedMonthly` estiver presente.
- Tratar como comparável apenas preço com status `verified`; valores `partial` não devem ser apresentados como equivalência válida.
- Mostrar `—` e o motivo recebido quando não existir preço/mapeamento.
- Exibir `meta.coveredCostPct` junto da recomendação.
- Diferenciar claramente provedor atual de destino comparado.
- Não reconstruir preços ausentes com multiplicadores ou médias.
- Tratar o evento `error` do SSE mesmo quando o HTTP retornou `200`.

## Teste validado

O cenário sintético documentado em `AI/MODULES/CATALOG.md` foi executado com sucesso em 2026-09-25:

- origem AWS `m7g.2xlarge`, 730 horas e USD 1.000 de custo atual;
- GCP `t2a-standard-8`: USD 547,50;
- Azure `Standard_D8ps_v5`: USD 620,50;
- cobertura verificada: 100%;
- recomendação: GCP;
- economia mensal: USD 452,50;
- payback: 7 meses;
- evento final `done` recebido.

`awsStatus: not_found` é esperado nesse cenário porque AWS é a origem e não é ranqueada como destino. OCI também fica `not_found` porque a fixture não contém oferta OCI.

## Limites atuais

- O cenário validado cobre `COMPUTE_VM`, `MANAGED_POSTGRES`, `OBJECT_STORAGE`, `SERVERLESS_FUNCTION`, `OBSERVABILITY_LOGS` e `DATA_TRANSFER`.
- Um serviço não pode reutilizar a estratégia de outro `resourceKind`.
- Os snapshots `*-multiservice-demo.json` são fixtures explícitas de teste; produção ainda requer importadores das fontes oficiais de preço.
- O parser do frontend precisa de colunas nativas suficientes; dados ambíguos devem ser rejeitados ou marcados como parciais.
- `migrationCost` ainda usa a heurística `totalCost × 3`.
- O backend não converte moedas.
- A equivalência de capacidade não substitui benchmark de performance.

Consulte também `AI/MODULES/CATALOG.md` para modelo, importação e fixtures.
