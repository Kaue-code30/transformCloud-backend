# Módulo: Catálogo de Provedores

> Atualizado em: 2026-10-05
> Status: catálogo determinístico e sincronizadores oficiais AWS, GCP, Azure e OCI implementados

## Objetivo

Manter ofertas, características técnicas, medidores e preços dos provedores dentro da aplicação. O catálogo é a fonte de verdade do mapeamento e da precificação; a IA não cria SKUs, regiões, equivalências nem valores.

## Componentes

| Arquivo | Responsabilidade |
|---|---|
| `catalog.types.ts` | Contrato do snapshot normalizado |
| `catalog-import.service.ts` | Importação atômica, idempotente e auditável |
| `catalog.repository.ts` | Consultas de ofertas, candidatos e overrides |
| `catalog-pricing.service.ts` | Cálculo por componentes e tiers |
| `catalog.module.ts` | Módulo NestJS |
| `commands/import-catalog.ts` | Importação de arquivo JSON pela linha de comando |
| `providers/aws/aws-catalog.adapter.ts` | AWS Price List Bulk API |
| `providers/gcp/gcp-catalog.adapter.ts` | Google Cloud Billing Catalog API |
| `providers/azure/azure-catalog.adapter.ts` | Azure Retail Prices API |
| `providers/oci/oci-catalog.adapter.ts` | OCI Public Price List API |

## Modelo

- `ProviderService`: serviço nativo associado a uma categoria canônica.
- `ProviderOffering`: produto implantável, como um tipo de VM.
- `ProviderMeter`: unidade faturável e sua vigência.
- `OfferingMeter`: quantidade de cada medidor usada por uma oferta.
- `PriceTier`: faixas de preço de um medidor.
- `MappingOverride`: equivalência revisada manualmente.
- `CatalogSyncRun`: auditoria de cada importação.

O JSON bruto de origem é mantido em `rawSource` para auditoria.

## Importação

### Sincronização oficial AWS

O adapter usa o AWS Price List Bulk API e grava `source: AWS_PRICE_LIST_BULK_API`. Serviço e região são obrigatórios. Prefira `--skus` para selecionar produtos oficiais exatos; `match` permanece disponível para descoberta:

```powershell
npm run catalog:sync:aws -- --service=AmazonRDS --region=sa-east-1 --skus=32MC36YXQJJ3PW4M --max=10
```

Quando `--skus` é usado, a sincronização falha se algum SKU solicitado estiver ausente ou incompatível. Isso impede uma importação parcial silenciosa.

### Sincronização oficial GCP

Configure `GCP_API_KEY` e informe serviço/região:

```powershell
npm run catalog:sync:gcp -- --service="Cloud SQL" --region=southamerica-east1 `
  --skus=E39B-9FA1-7D40,2814-6049-A086 --kind=MANAGED_POSTGRES `
  --offering=db-custom-2-16 --vcpu=2 --memory=16 --engine=PostgreSQL
```

O nome atual do serviço de funções no catálogo do Google é `Cloud Run Functions`; o comando também aceita o alias legado `Cloud Functions`. O adapter persiste `source: GCP_CLOUD_BILLING_CATALOG_API` e preserva `skuId`, descrição, regiões, `pricingExpression`, unidade, moeda, vigência e tiers.

Ofertas compostas, como VM e Cloud SQL customizado, usam vários SKUs exatos na mesma oferta. CPU e memória recebem suas quantidades técnicas antes do cálculo. O limite de varredura padrão é 50.000 SKUs porque serviços grandes, como Compute Engine e Cloud SQL, superam 20.000 registros.

### Sincronização oficial Azure

O adapter consulta a [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), pagina `NextPageLink` e grava `source: AZURE_RETAIL_PRICES_API`. Os filtros exatos de produto, medidor, SKU e ARM SKU evitam misturar modalidades:

```powershell
npm run catalog:sync:azure -- --service="Virtual Machines" --region=brazilsouth `
  --armSku=Standard_D8ps_v6 --kind=COMPUTE_VM --offering=Standard_D8ps_v6 `
  --vcpu=8 --memory=32 --os=Linux --arch=arm64
```

Somente preços de consumo são aceitos; Spot, Low Priority e capacidade descontada ficam fora quando a oferta é On-Demand.

### Sincronização oficial OCI

O adapter consulta a [OCI Public Price List API](https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/), normaliza `PAY_AS_YOU_GO`, faixas, multiplicadores e grava `source: OCI_PUBLIC_PRICE_LIST_API`. Use `--partNumbers` para ofertas compostas:

```powershell
npm run catalog:sync:oci -- --region=sa-saopaulo-1 `
  --partNumbers=B93297,B93298 --kind=COMPUTE_VM `
  --offering=VM.Standard.A1.Flex-8-32 --vcpu=8 --ocpu=8 `
  --memory=32 --os=Linux --arch=arm64
```

A sincronização falha se algum part number solicitado não estiver presente. O payload bruto e a data efetiva da importação são preservados para auditoria.

### Fontes e persistência

Cada sincronização grava ofertas, medidores e tiers no PostgreSQL. A análise usa esses registros locais e não consulta os provedores a cada upload. Novas consultas externas acontecem somente quando um comando `catalog:sync:*` é executado.

Fixtures com `sourceKey` iniciado por `TEST:` não participam do matching normal. Para um teste reproduzível exclusivamente com fixtures, configure `CATALOG_ALLOW_TEST_FIXTURES=true`.

Depois de aplicar a migration e gerar o Prisma Client:

```bash
npm run catalog:import -- ./catalog/aws-compute-sa-east-1.json
```

O arquivo deve seguir `CatalogSnapshot`:

```json
{
  "provider": "AWS",
  "source": "AWS Price List Bulk API + DescribeInstanceTypes",
  "version": "2026-09-24",
  "mode": "PARTIAL",
  "services": [
    {
      "nativeCode": "AmazonEC2",
      "name": "Amazon EC2",
      "resourceKind": "COMPUTE_VM"
    }
  ],
  "offerings": [
    {
      "sourceKey": "AWS:AmazonEC2:sa-east-1:Linux:m7g.2xlarge:ON_DEMAND",
      "serviceNativeCode": "AmazonEC2",
      "nativeProductId": "<product SKU da AWS>",
      "nativeSkuName": "m7g.2xlarge",
      "displayName": "Amazon EC2 m7g.2xlarge",
      "region": "sa-east-1",
      "purchaseOption": "ON_DEMAND",
      "operatingSystem": "Linux",
      "architecture": "arm64",
      "family": "m7g",
      "generation": "7",
      "vcpu": 8,
      "memoryGiB": 32,
      "attributes": {},
      "rawSource": {}
    }
  ],
  "meters": [
    {
      "sourceKey": "AWS:<price-dimension-code>",
      "serviceNativeCode": "AmazonEC2",
      "nativeSkuId": "<product SKU da AWS>",
      "name": "Linux On Demand instance hour",
      "region": "sa-east-1",
      "pricingUnit": "Hrs",
      "unitMultiplier": 1,
      "currency": "USD",
      "priceType": "ON_DEMAND",
      "effectiveFrom": "2026-09-24T00:00:00.000Z",
      "attributes": {},
      "rawSource": {},
      "tiers": [
        {
          "startQuantity": 0,
          "unitPrice": 0.0
        }
      ]
    }
  ],
  "offeringMeters": [
    {
      "offeringSourceKey": "AWS:AmazonEC2:sa-east-1:Linux:m7g.2xlarge:ON_DEMAND",
      "meterSourceKey": "AWS:<price-dimension-code>",
      "quantity": 1
    }
  ]
}
```

O preço `0.0` acima é apenas estrutural. Snapshots de produção devem preservar o preço e o payload recebidos da fonte oficial.

`sourceKey` deve ser estável e globalmente único. A recomendação é prefixar com provedor, serviço, região e identificador nativo.

`mode: FULL` desativa ofertas anteriores do provedor antes de ativar as presentes no snapshot. Use apenas quando o arquivo representar o catálogo completo. `PARTIAL` não desativa itens ausentes.

## Matching por tipo de recurso

Ordem aplicada:

1. Localiza a oferta de origem por SKU/produto nativo.
2. Usa `MappingOverride` aprovado, quando existir.
3. Filtra destino pelo mesmo `resourceKind`, região e modalidade.
4. Para compute e banco, também compara engine/capacidade; para serviços medidos, preserva quantidade e unidade.
5. Retorna evidências, score e `catalogOfferingId`.

Sem SKU de origem ou capacidade suficiente, o serviço retorna `unmapped`; não existe fallback por IA.

## Limites atuais

- Matchers validados para compute, PostgreSQL gerenciado, object storage, funções, logs e transferência.
- AWS, GCP, Azure e OCI possuem adaptadores oficiais e registros reais validados no PostgreSQL.
- A lista pública da OCI oferece `OCI - Logging - Storage` em `GB-mês`, mas não um medidor diretamente equivalente à ingestão `GB` do CloudWatch. Esse par permanece `not_found` para OCI em vez de usar um preço sintético ou assumir retenção de 30 dias.
- Equivalência de capacidade não garante equivalência de performance; benchmarks são uma etapa posterior.
- Regiões equivalentes do MVP estão na tabela determinística do matcher.
- Os adapters importam preços públicos On-Demand. Descontos contratuais, impostos, câmbio e compromissos precisam de fontes separadas.
- A API pública da OCI publica preços globais em USD; a região é anexada à oferta solicitada e deve ser validada contra a disponibilidade regional do serviço antes de uma migração.

## Teste local reproduzível

As fixtures de catálogo em `test/fixtures/catalog` usam valores sintéticos e servem apenas para validar o fluxo. Elas não representam preços reais dos provedores. Habilite-as explicitamente:

Com `DATABASE_URL` apontando para um PostgreSQL de desenvolvimento, aplique as migrations e importe os quatro catálogos:

```powershell
$env:CATALOG_ALLOW_TEST_FIXTURES = "true"
npx prisma migrate deploy
npm run catalog:import -- test/fixtures/catalog/aws-multiservice-demo.json
npm run catalog:import -- test/fixtures/catalog/gcp-multiservice-demo.json
npm run catalog:import -- test/fixtures/catalog/azure-multiservice-demo.json
npm run catalog:import -- test/fixtures/catalog/oci-multiservice-demo.json
```

Inicie a API. A chave `ANTHROPIC_API_KEY` é opcional neste teste; sem ela, a redação da recomendação também é determinística.

```bash
npm run start:dev
```

Em outro terminal PowerShell, envie a fatura de demonstração usando `curl.exe` (e não o alias `curl`):

```powershell
curl.exe -N -X POST http://localhost:3001/api/billing/analyze/stream `
  -H "Content-Type: application/json" `
  --data-binary "@test/fixtures/billing/aws-compute-demo-request.json"
```

O stream deve terminar com um evento `done`. Para 730 horas, os resultados esperados são GCP a USD 547,50 e Azure a USD 620,50; portanto, a recomendação calculada deve ser GCP. A AWS é a origem e não participa do ranking de destino.

### Execução validada com preços oficiais

Em 2026-10-05, o arquivo `test/fixtures/billing/aws-sa-east-1-real-prices-2026-09.csv` foi processado pelo frontend e pelo backend com fixtures desabilitadas. Os seis serviços foram resolvidos e precificados por fontes oficiais:

- EC2 e RDS: GCP, Azure e OCI verificados;
- S3, Lambda e Data Transfer: GCP, Azure e OCI verificados;
- CloudWatch Logs: GCP e Azure verificados; OCI corretamente sem equivalência direta;
- metadados gerais: 6 serviços verificados e 100% do custo com ao menos uma alternativa oficial;
- recomendação calculada: OCI, com 92% do custo coberto por equivalências oficiais desse provedor.

As fontes retornadas foram `GCP_CLOUD_BILLING_CATALOG_API`, `AZURE_RETAIL_PRICES_API` e `OCI_PUBLIC_PRICE_LIST_API`. Nenhum item do resultado validado usou `TEST_FIXTURE_ONLY`.

Se o PowerShell mostrar textos como `serviÃ§os`, configure UTF-8 antes do `curl.exe`:

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
```

Esse efeito é apenas a decodificação do terminal; o JSON e a API continuam válidos.
