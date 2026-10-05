# Arquitetura de Billing V2 — Backend

> Atualizado em: 2026-10-05

## Princípio

O catálogo local é a fonte de verdade. A IA não mapeia serviços, não fornece preços e não escolhe o provedor recomendado.

```text
ParsedBilling.lineItems
  -> normalização
  -> resolução da oferta de origem
  -> matching determinístico por destino
  -> cálculo dos medidores e tiers
  -> classificação de cobertura
  -> ranking por custo verificado
  -> redação opcional
  -> payback/ROI
```

## Dados persistidos

| Entidade | Papel |
|---|---|
| `ProviderService` | serviço nativo e categoria canônica |
| `ProviderOffering` | produto implantável e capacidade técnica |
| `ProviderMeter` | unidade faturável, moeda e vigência |
| `PriceTier` | faixas de preço |
| `OfferingMeter` | composição do custo de uma oferta |
| `MappingOverride` | equivalência revisada manualmente |
| `CatalogSyncRun` | auditoria de importação |

O payload bruto da fonte é preservado em `rawSource`.

## Pipeline

### 1. Normalização

`PipelineService` transforma `lineItems` em `topServices`, preserva a ligação por `sourceLineItemKey`, remove itens não técnicos, ordena por custo e limita a análise a 25 linhas agregadas.

### 2. Mapeamento

`DeterministicMappingService`:

1. localiza a oferta de origem por SKU, meter, nome nativo, produto e região;
2. aplica um `MappingOverride` aprovado quando existir;
3. resolve a região equivalente por tabela versionada em código;
4. filtra ofertas de destino por categoria, modalidade, SO, arquitetura, vCPU e memória;
5. pontua diferenças de capacidade;
6. retorna ID do catálogo, evidências, score e confiança.

Sem identidade/capacidade suficiente, retorna `unmapped`. Não existe fallback por IA.

### 3. Preço

`CatalogPricingService` busca os medidores associados à oferta, verifica vigência e moeda, aplica multiplicadores e calcula os tiers sobre a quantidade de uso.

Sem medidor vigente ou com componentes em moedas diferentes, o preço não é retornado.

### 4. Classificação

`PricingOrchestratorService` classifica cada destino como:

- `verified`: preço presente, mesma moeda e matching de alta confiança;
- `partial`: preço presente com confiança menor ou outra moeda;
- `not_found`: mapeamento ou preço ausente;
- `no_api`: mantido no contrato por compatibilidade.

### 5. Recomendação

O ranking é calculado por código. Para cada destino, são considerados apenas itens `verified`, com `estimatedMonthly` e na mesma moeda do billing.

```text
economia_verificada = custo_atual_coberto - custo_destino_coberto
custo_projetado = custo_total_atual - economia_verificada
```

O menor custo projetado com economia positiva vence. Sem candidato confiável, a recomendação é manter o provedor atual.

Quando `ANTHROPIC_API_KEY` existe, Claude recebe a decisão pronta e pode somente redigir razões, insights e resumo. O provedor e a flag `basedOnVerified` são sobrescritos com os valores calculados antes da resposta final.

### 6. Payback

```text
migrationCost = totalCost × 3
monthlySaving = soma das economias verificadas do provedor recomendado
paybackMonths = ceil(migrationCost / monthlySaving)
roi(N) = ((monthlySaving × N - migrationCost) / migrationCost) × 100
```

A heurística de custo de migração ainda deve se tornar configurável.

## Transporte SSE

O endpoint `POST /api/billing/analyze/stream` escreve frames `data: <json>\n\n`. É um `POST` porque recebe o billing no body; consumidores devem usar `fetch` + `ReadableStream`.

Eventos: `mapping`, `pricing`, `classification`, `recommendation`, `done` e `error`.

## Estado atual

- `COMPUTE_VM`, `MANAGED_POSTGRES`, `OBJECT_STORAGE`, `SERVERLESS_FUNCTION`, `OBSERVABILITY_LOGS` e `DATA_TRANSFER`: matching e preço validados ponta a ponta.
- AWS, GCP, Azure e OCI: adapters oficiais implementados e persistidos no catálogo local.
- Cache, Kubernetes, balanceadores e WAF: modelos previstos, matchers e sincronizações específicas pendentes.
- Fixtures `TEST:*`: excluídas por padrão e habilitadas somente com `CATALOG_ALLOW_TEST_FIXTURES=true`.
- Override manual: persistência e leitura implementadas; interface administrativa pendente.

## Teste de referência

O teste oficial usa `test/fixtures/billing/aws-sa-east-1-real-prices-2026-09.csv`. As fixtures sintéticas continuam disponíveis para testes unitários e cenários offline. Consulte `AI/MODULES/CATALOG.md` para comandos, fontes e limitações.
