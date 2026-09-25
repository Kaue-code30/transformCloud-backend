# Módulo: Catálogo de Provedores

> Atualizado em: 2026-09-25  
> Status: catálogo e matchers determinísticos implementados; sincronizadores oficiais AWS e GCP disponíveis

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

O primeiro adapter oficial usa o AWS Price List Bulk API e grava `source: AWS_PRICE_LIST_BULK_API`. Serviço e região são obrigatórios; `match` e `max` limitam a carga:

```powershell
npm run catalog:sync:aws -- --service=AWSLambda --region=sa-east-1 --match=Lambda-GB-Second --max=25
```

Quando um tipo medido possui várias ofertas incompatíveis, o matcher exige uma equivalência aprovada em vez de escolher arbitrariamente. As fixtures `TEST_FIXTURE_ONLY` continuam separadas para testes reproduzíveis.

### Sincronização oficial GCP

Configure `GCP_API_KEY` e informe serviço/região:

```powershell
npm run catalog:sync:gcp -- --service="Cloud Run Functions" --region=southamerica-east1 --max=500
```

O nome atual do serviço no catálogo do Google é `Cloud Run Functions`; o comando também aceita o alias legado `Cloud Functions`. O adapter persiste `source: GCP_CLOUD_BILLING_CATALOG_API` e preserva `skuId`, descrição, regiões, `pricingExpression`, unidade, moeda, vigência e tiers.

Validação real em 2026-09-25: 22 ofertas, 22 medidores e 68 itens importados para `southamerica-east1`. No cenário de teste, 120.000 GB-segundos da AWS Lambda foram associados ao medidor oficial `GiBy.s` e estimados em USD 0,42.

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
- AWS e GCP já possuem adaptadores oficiais; Azure e OCI ainda usam fixtures até que seus sincronizadores sejam implementados.
- No GCP, a validação oficial realizada até aqui cobre `Cloud Run Functions`; compute, banco, storage, logs e transferência ainda dependem das fixtures locais no cenário completo.
- Equivalência de capacidade não garante equivalência de performance; benchmarks são uma etapa posterior.
- Regiões equivalentes do MVP estão na tabela determinística do matcher.
- Preços públicos e preços contratuais precisam ser importados como fontes distintas no futuro.

## Teste local reproduzível

As fixtures em `test/fixtures` usam valores sintéticos e servem apenas para validar o fluxo. Elas não representam preços reais dos provedores.

Com `DATABASE_URL` apontando para um PostgreSQL de desenvolvimento, aplique as migrations e importe os quatro catálogos:

```bash
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

### Execução validada

O cenário acima foi executado com sucesso em 2026-09-25. O resultado confirmou matching exato para GCP e Azure, 100% de cobertura, economia mensal de USD 452,50 no GCP e payback de 7 meses.

O CSV multisser serviço do frontend também foi executado na mesma data. EC2, RDS, S3, Lambda, CloudWatch e Data Transfer terminaram com 6/6 serviços verificados, 100% de cobertura e zero itens não mapeados nos três provedores de destino. Os valores são exclusivamente de fixture (`TEST_FIXTURE_ONLY`).

Se o PowerShell mostrar textos como `serviÃ§os`, configure UTF-8 antes do `curl.exe`:

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
```

Esse efeito é apenas a decodificação do terminal; o JSON e a API continuam válidos.
