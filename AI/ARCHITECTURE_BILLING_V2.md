# Arquitetura: Billing Analysis V2

> Status: Descritivo de solução — aprovado para implementação  
> Data: 2026-05-19  
> Abordagem: Opção C (Híbrido) com Claude como mapeador de serviços

---

## Visão Geral

A análise de billing deixa de ser 100% responsabilidade da IA e passa a ser um **pipeline em 6 etapas**, onde cada camada faz somente o que é melhor para ela:

```
Arquivo de Billing
       ↓
[1] SEU CÓDIGO    → Parsing, detecção, top N serviços
       ↓
[2] CLAUDE (1ª chamada, pequena) → Mapeamento de serviços entre provedores
       ↓
[3] SEU CÓDIGO    → Busca de preços reais nas APIs dos provedores
       ↓
[4] SEU CÓDIGO    → Classificação: verificado / parcial / não encontrado
       ↓
[5] CLAUDE (2ª chamada, focada) → Recomendação e texto com base nos dados reais
       ↓
[6] SEU CÓDIGO    → Cálculo de PAYBACK e ROI (matemática pura)
       ↓
Resposta para o cliente (com transparência sobre o que foi e não foi verificado)
```

---

## Etapa 1 — Parsing e Análise Inicial (seu código)

**Quem executa:** servidor Next.js, sem IA, sem API externa  
**Tempo estimado:** < 1 segundo

### O que acontece:

1. **Detectar formato do arquivo**
   - CSV: parsear por colunas (service, cost, date, etc.)
   - JSON: navegar na estrutura
   - TXT: extração por regex

2. **Detectar provedor atual**
   - Regras de keyword: "Amazon" / "AWS" / "EC2" / "S3" → AWS
   - "Google" / "GCP" / "BigQuery" / "GKE" → GCP
   - "Microsoft" / "Azure" → Azure
   - "Oracle" / "OCI" → OCI

3. **Extrair e estruturar os dados**
   - Período de billing (data início / fim)
   - Moeda detectada
   - Lista de serviços com: nome, especificações técnicas, custo, região

4. **Calcular métricas financeiras**
   - Custo total do período
   - Custo por serviço + percentual do total
   - Tendência diária (média, pico, variação)
   - Concentração: "top 5 serviços = X% do custo"

5. **Selecionar o Top 5/6**
   - Ordenar por custo decrescente
   - Pegar os que representam maior fatia
   - Capturar especificações técnicas de cada um (tipo de instância, região, tier)

6. **Validar qualidade dos dados**
   - Campos faltando?
   - Valores negativos (créditos)?
   - Linhas duplicadas?
   - Período incompleto?

### O que sai desta etapa:

```json
{
  "provider": "AWS",
  "period": { "start": "2026-04-01", "end": "2026-04-30" },
  "currency": "USD",
  "totalCost": 12450.00,
  "dataQuality": "good",
  "topServices": [
    {
      "name": "Amazon EC2",
      "specs": "t3.medium, us-east-1, Linux, On-Demand",
      "cost": 5200.00,
      "pct": 41.8,
      "quantity": "720 horas"
    },
    {
      "name": "Amazon RDS",
      "specs": "db.m5.large, MySQL, Multi-AZ, us-east-1",
      "cost": 3100.00,
      "pct": 24.9,
      "quantity": "720 horas"
    },
    {
      "name": "Amazon S3",
      "specs": "Standard Storage, us-east-1",
      "cost": 1800.00,
      "pct": 14.5,
      "quantity": "18 TB"
    },
    {
      "name": "Amazon CloudFront",
      "specs": "us-east-1, HTTPS",
      "cost": 980.00,
      "pct": 7.9,
      "quantity": "9.8 TB transferidos"
    },
    {
      "name": "AWS Lambda",
      "specs": "us-east-1, 512MB",
      "cost": 620.00,
      "pct": 5.0,
      "quantity": "42M invocações"
    }
  ]
}
```

---

## Etapa 2 — Mapeamento de Serviços (Claude — 1ª chamada)

**Quem executa:** Claude Sonnet (via Anthropic API)  
**Tempo estimado:** 5–10 segundos  
**Objetivo:** Claude recebe os serviços com suas specs técnicas e retorna qual é o serviço equivalente em cada provedor, com os parâmetros necessários para consultar a API de preços

### O que Claude recebe:

Um prompt pequeno e estruturado com os top serviços da etapa anterior. Sem arquivo completo, sem contexto desnecessário.

### O que Claude retorna:

```json
{
  "mappings": [
    {
      "original": "Amazon EC2 t3.medium us-east-1 Linux On-Demand",
      "gcp": {
        "service": "Compute Engine",
        "machineType": "e2-medium",
        "region": "us-central1",
        "confidence": "high"
      },
      "azure": {
        "service": "Virtual Machines",
        "skuName": "B2s",
        "region": "eastus",
        "confidence": "high"
      },
      "oci": {
        "service": "Compute",
        "shape": "VM.Standard.E4.Flex",
        "ocpu": 1,
        "memoryGb": 4,
        "confidence": "medium"
      }
    },
    {
      "original": "Amazon RDS db.m5.large MySQL Multi-AZ us-east-1",
      "gcp": {
        "service": "Cloud SQL",
        "tier": "db-n1-standard-2",
        "region": "us-central1",
        "highAvailability": true,
        "confidence": "high"
      },
      "azure": {
        "service": "Azure Database for MySQL",
        "sku": "GP_Gen5_2",
        "region": "eastus",
        "confidence": "medium"
      },
      "oci": {
        "service": "MySQL HeatWave",
        "shape": "MySQL.2",
        "confidence": "low"
      }
    }
  ]
}
```

**Nota sobre confidence:**
- `high` — mapeamento direto, equivalente claro
- `medium` — equivalente próximo, pode haver diferença de features
- `low` — estimativa, sem equivalente direto claro

Claude **não busca preços** nesta etapa. Só mapeia. Chamada rápida e barata.

---

## Etapa 3 — Busca de Preços Reais (seu código)

**Quem executa:** servidor Next.js, chamadas às APIs dos provedores  
**Tempo estimado:** 3–8 segundos (chamadas paralelas)

### APIs utilizadas:

**Azure Retail Prices API**
```
GET https://prices.azure.com/api/retail/prices
  ?$filter=serviceName eq 'Virtual Machines'
    and armSkuName eq 'Standard_B2s'
    and armRegionName eq 'eastus'
    and priceType eq 'Consumption'
```
Pública, sem autenticação, JSON limpo.

**AWS Pricing API**
```
GET https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.json
  + filtros por instanceType, operatingSystem, tenancy
```
Pública, sem autenticação. Arquivo grande — requer filtragem.

**GCP Cloud Billing API**
```
GET https://cloudbilling.googleapis.com/v1/services/{serviceId}/skus
  ?currencyCode=USD
```
Requer API key pública (sem custo, sem auth OAuth).

**OCI**
Sem API estruturada pública disponível. Sempre retorna `null`.

### O que sai desta etapa:

```json
{
  "prices": [
    {
      "service": "Amazon EC2 t3.medium",
      "currentCost": 5200.00,
      "gcp": {
        "price": 0.0338,
        "unit": "hora",
        "estimatedMonthly": 4392.00,
        "source": "GCP Billing API",
        "verified": true
      },
      "azure": {
        "price": 0.0416,
        "unit": "hora",
        "estimatedMonthly": 5408.00,
        "source": "Azure Retail Prices API",
        "verified": true
      },
      "oci": {
        "price": null,
        "verified": false,
        "reason": "API não disponível"
      }
    },
    {
      "service": "Amazon RDS db.m5.large MySQL Multi-AZ",
      "currentCost": 3100.00,
      "gcp": {
        "price": 0.1740,
        "unit": "hora",
        "estimatedMonthly": 2538.00,
        "source": "GCP Billing API",
        "verified": true
      },
      "azure": {
        "price": null,
        "verified": false,
        "reason": "SKU não encontrado — mapeamento confidence: medium"
      },
      "oci": {
        "price": null,
        "verified": false,
        "reason": "API não disponível"
      }
    }
  ]
}
```

---

## Etapa 4 — Classificação de Confiança (seu código)

**Quem executa:** servidor Next.js, lógica de negócio  
**Tempo estimado:** < 100ms

Cada serviço recebe um status de verificação:

| Status | Critério | Como aparece na UI |
|--------|----------|-------------------|
| `verified` | Preço encontrado via API + confidence high | Badge verde "Verificado" |
| `partial` | Preço encontrado mas confidence medium/low | Badge amarelo "Estimativa" |
| `not_found` | API não retornou resultado | Badge cinza "Não verificado" |
| `no_api` | Provedor sem API (OCI) | Badge cinza "Sem dados" |

---

## Etapa 5 — Recomendação e Texto (Claude — 2ª chamada)

**Quem executa:** Claude Sonnet  
**Tempo estimado:** 10–20 segundos  
**Objetivo:** Gerar recomendação, análise qualitativa e sumário com base apenas nos dados reais

### O que Claude recebe:

O resultado estruturado das etapas anteriores — somente dados verificados, com flags de confiança. Claude **não faz web search** nesta etapa.

### O que Claude retorna:

```json
{
  "recommendation": {
    "provider": "GCP",
    "basedOnVerified": true,
    "migrationComplexity": "Média",
    "reasons": [
      "EC2 equivalente no GCP (e2-medium) representa economia de 15.5% verificada via API",
      "Cloud SQL MySQL com HA representa economia de 18.1% verificada via API",
      "Azure não foi verificado para RDS — comparação incompleta"
    ],
    "topServices": ["EC2", "RDS"],
    "cfa_justification": "Com base nos serviços verificados (67% do custo total), a migração para GCP apresenta economia mensal de $1.370 nos itens analisados. Os demais 33% do custo não puderam ser verificados nesta análise."
  },
  "insights": [
    "EC2 e RDS juntos representam 66.7% do seu custo — foco correto para migração",
    "GCP apresentou preço verificado inferior para 2 dos 5 serviços analisados",
    "OCI não pôde ser comparado — sem API pública disponível"
  ],
  "summary": "Análise baseada em preços verificados via API para 3 dos 5 serviços (78% do custo). GCP apresenta melhor custo nos itens verificados. Recomenda-se análise manual de S3 e Lambda antes de decisão final."
}
```

Claude é explícito sobre o que foi e não foi verificado. Nada inventado.

---

## Etapa 6 — Cálculo de PAYBACK (seu código)

**Quem executa:** servidor Next.js, matemática pura  
**Tempo estimado:** < 100ms

### Variáveis de entrada:

- `currentMonthlyCost` — custo mensal atual (da etapa 1)
- `estimatedNewCost` — custo verificado no novo provedor (etapa 3)
- `migrationCost` — custo estimado de migração (pode ter defaults configuráveis)
  - Horas de engenheiro × valor/hora
  - Custo de downtime
  - Treinamento

### Cálculos:

```
Economia mensal = currentMonthlyCost - estimatedNewCost
Payback (meses) = migrationCost / economiasMensal
ROI 12 meses = ((economia × 12) - migrationCost) / migrationCost × 100
ROI 24 meses = ((economia × 24) - migrationCost) / migrationCost × 100
Break-even = mês exato em que investimento é recuperado
```

### O que sai desta etapa:

```json
{
  "payback": {
    "basedOnVerified": true,
    "coveredCostPct": 78,
    "monthlySaving": 1370.00,
    "migrationCost": 18000.00,
    "paybackMonths": 13.1,
    "roi12m": -8.3,
    "roi24m": 82.7,
    "roi36m": 173.7,
    "breakEvenMonth": 14,
    "disclaimer": "Calculado com base em 78% do custo total verificado via API. Os 22% restantes não foram incluídos no cálculo."
  }
}
```

---

## Resposta Final para o Cliente

A resposta consolida todas as etapas com **transparência total**:

```json
{
  "meta": {
    "analyzedServices": 5,
    "verifiedServices": 3,
    "partialServices": 1,
    "notFoundServices": 1,
    "coveredCostPct": 78,
    "analysisDate": "2026-04-30"
  },
  "billing": { ... },        // etapa 1
  "mappings": { ... },       // etapa 2
  "prices": { ... },         // etapa 3 (com flags verified/partial/not_found)
  "recommendation": { ... }, // etapa 5
  "payback": { ... }         // etapa 6
}
```

---

## O que a UI mostra com transparência

| Elemento | Comportamento |
|----------|--------------|
| Preço verificado | Valor exato + badge verde "Verificado via API" |
| Preço parcial | Valor + badge amarelo "Estimativa (confidence médio)" |
| Preço não encontrado | "—" + badge cinza "Não verificado nesta análise" |
| OCI | "—" + "Sem API pública disponível" |
| PAYBACK | Exibe % do custo que foi base do cálculo |
| Recomendação | "Baseada em X% do seu custo verificado" |

---

## Resumo do Pipeline

| Etapa | Responsável | Tempo | Custo |
|-------|-------------|-------|-------|
| 1. Parsing e análise inicial | Seu código | < 1s | Grátis |
| 2. Mapeamento de serviços | Claude (pequena chamada) | 5–10s | Baixo |
| 3. Busca de preços reais | Seu código → APIs públicas | 3–8s (paralelo) | Grátis |
| 4. Classificação de confiança | Seu código | < 0,1s | Grátis |
| 5. Recomendação e texto | Claude (chamada focada) | 10–20s | Baixo |
| 6. Cálculo de PAYBACK | Seu código | < 0,1s | Grátis |
| **Total estimado** | | **~25–40s** | **Muito menor que hoje** |

**Hoje:** 1 chamada de 120s, tudo na IA, valores estimados  
**V2:** ~35s no total, 2 chamadas pequenas de IA, preços reais onde possível, transparência total

---

## Próximos passos para implementação

1. Construir o parser de billing (CSV/JSON/TXT) com detecção de provedor
2. Definir o prompt de mapeamento para Claude (etapa 2)
3. Implementar os clientes das APIs: Azure Retail Prices, AWS Pricing, GCP Billing
4. Construir a lógica de classificação de confiança (etapa 4)
5. Adaptar o prompt de recomendação para trabalhar com dados estruturados (etapa 5)
6. Implementar cálculo de PAYBACK (etapa 6)
7. Atualizar a UI para refletir a transparência de verificação
