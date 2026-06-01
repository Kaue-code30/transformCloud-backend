import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ParsedBilling,
  MappingResult,
  ClassificationResult,
  RecommendationResult,
} from '../types/pipeline.types';

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic;
  private readonly model = 'claude-opus-4-7';

  // System prompt estável — cacheado entre requisições (prompt caching)
  private readonly systemPrompt = `Você é um especialista em migração de infraestrutura cloud.
Seu papel é analisar bills de provedores cloud (AWS, GCP, Azure, OCI) e fornecer:
1. Mapeamento preciso de serviços entre provedores
2. Recomendações estratégicas de migração com justificativas técnicas e financeiras

Responda SEMPRE em JSON válido conforme o schema solicitado. Sem texto extra fora do JSON.`;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey || apiKey.includes('COLOQUE_SUA_CHAVE')) {
      this.logger.warn('ANTHROPIC_API_KEY não configurada — etapas de IA retornarão erro.');
    }
    this.client = new Anthropic({ apiKey: apiKey ?? '' });
  }

  // ─── Etapa 2: Mapeamento de serviços ─────────────────────────────────────

  async mapServices(billing: ParsedBilling): Promise<MappingResult> {
    const prompt = buildMappingPrompt(billing);

    const raw = await this.ask(prompt, 8192);
    if (!raw) return { mappings: [] };

    const parsed = safeParseJson<MappingResult>(raw);
    if (!parsed) {
      this.logger.error('Resposta de mapeamento não é JSON válido');
      return { mappings: [] };
    }

    return parsed;
  }

  // ─── Etapa 5: Recomendação ────────────────────────────────────────────────

  async generateRecommendation(
    billing: ParsedBilling,
    prices: ClassificationResult,
  ): Promise<RecommendationResult> {
    const prompt = buildRecommendationPrompt(billing, prices);

    const raw = await this.ask(prompt, 2048);
    if (!raw) return fallbackRecommendation();

    const parsed = safeParseJson<RecommendationResult>(raw);
    if (!parsed) {
      this.logger.error('Resposta de recomendação não é JSON válido');
      return fallbackRecommendation();
    }

    return parsed;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private async ask(prompt: string, maxTokens: number): Promise<string | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system: [
          {
            type: 'text' as const,
            text: this.systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: [{ role: 'user', content: prompt }],
      });

      const block = response.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') return null;

      this.logger.debug(
        `Tokens — input: ${response.usage.input_tokens} | output: ${response.usage.output_tokens} | cache_read: ${(response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0}`,
      );

      return block.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro na chamada Claude: ${msg}`);
      return null;
    }
  }
}

// ─── Helpers puros (fora da classe) ──────────────────────────────────────────

function safeParseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  // Extrai o primeiro bloco JSON da resposta, mesmo se vier com markdown
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function buildMappingPrompt(billing: ParsedBilling): string {
  const services = (billing.topServices ?? [])
    .map((s) => `- ${s.name ?? '?'} | specs: ${s.specs ?? '-'} | custo: ${s.cost ?? 0} | qtd: ${s.quantity ?? '-'}`)
    .join('\n');

  const regionConstraint = billing.targetRegion
    ? `\nRESTRIÇÃO DE REGIÃO: O cliente EXIGE que os serviços destino estejam na região "${billing.targetRegion}" ou equivalente próximo. Use apenas regiões dessa localidade geográfica para gcp.region e azure.region.`
    : '';

  // Referência de regiões equivalentes para o Claude usar
  const regionReference = `
REGIÕES EQUIVALENTES (use como referência para escolher gcp.region e azure.region):
- us-east-1 (AWS N. Virginia)  → us-east4 (GCP)           → eastus (Azure)
- us-east-2 (AWS Ohio)         → us-east1 (GCP)           → eastus2 (Azure)
- us-west-2 (AWS Oregon)       → us-west1 (GCP)           → westus2 (Azure)
- sa-east-1 (AWS São Paulo)    → southamerica-east1 (GCP) → brazilsouth (Azure)
- eu-west-1 (AWS Irlanda)      → europe-west1 (GCP)       → westeurope (Azure)
- eu-central-1 (AWS Frankfurt) → europe-west3 (GCP)       → germanywestcentral (Azure)
- ap-southeast-1 (AWS Singapura)→ asia-southeast1 (GCP)  → southeastasia (Azure)
- ap-northeast-1 (AWS Tóquio)  → asia-northeast1 (GCP)   → japaneast (Azure)`;

  return `Mapeie os seguintes serviços ${billing.provider} para equivalentes em GCP, Azure e OCI.

Bill de origem:
- Provedor: ${billing.provider}
- Período: ${billing.period.start} a ${billing.period.end}
- Custo total: ${billing.currency} ${billing.totalCost}
${regionConstraint}
Serviços a mapear:
${services}
${regionReference}

REGRAS OBRIGATÓRIAS para os campos:
- gcp.service: APENAS um destes valores exatos: "Compute Engine", "Cloud SQL", "Cloud Storage", "Cloud Run", "BigQuery", "Memorystore", "Cloud Armor"
- gcp.machineType: somente o tipo de máquina simples (ex: "n2-standard-2", "e2-medium", "db-custom-2-4096"). SEM texto adicional.
- gcp.region: somente o identificador de região GCP (ex: "us-east4", "southamerica-east1"). SEM texto adicional.
- azure.service: APENAS um destes valores exatos: "Virtual Machines", "Azure Database for PostgreSQL Flexible Server", "Azure Database for MySQL Flexible Server", "Azure Blob Storage", "Azure Cache for Redis", "Azure Application Gateway"
- azure.skuName e azure.sku: somente o SKU simples (ex: "Standard_D2s_v3"). SEM texto adicional.
- azure.region: somente o identificador de região Azure (ex: "eastus", "brazilsouth"). SEM texto adicional.
- aws.service: APENAS um destes valores exatos: "AmazonEC2", "AmazonRDS", "AmazonS3", "AWSLambda", "AmazonElastiCache", "AWSWAFv2"
- aws.instanceType: somente o tipo de instância simples (ex: "m7g.2xlarge", "db.r6g.2xlarge"). SEM texto adicional.
- aws.region: somente o identificador de região AWS (ex: "us-east-1", "sa-east-1"). SEM texto adicional.
- aws.operatingSystem: "Linux" ou "Windows" (somente para EC2).

Retorne JSON no formato exato:
{
  "mappings": [
    {
      "original": "<nome original>",
      "gcp": {
        "service": "Compute Engine",
        "machineType": "n2-standard-2",
        "region": "us-east4",
        "confidence": "high|medium|low"
      },
      "azure": {
        "service": "Virtual Machines",
        "skuName": "Standard_D2s_v3",
        "sku": "Standard_D2s_v3",
        "region": "eastus",
        "confidence": "high|medium|low"
      },
      "aws": {
        "service": "AmazonEC2",
        "instanceType": "m7g.2xlarge",
        "region": "us-east-1",
        "operatingSystem": "Linux",
        "confidence": "high|medium|low"
      },
      "oci": {
        "service": "Compute",
        "shape": "VM.Standard.E4.Flex",
        "ocpu": 2,
        "memoryGb": 8,
        "confidence": "high|medium|low"
      }
    }
  ]
}`;
}

function buildRecommendationPrompt(
  billing: ParsedBilling,
  prices: ClassificationResult,
): string {
  const summary = prices.classified
    .map(
      (c) =>
        `- ${c.service}: atual ${billing.currency}${c.currentCost} | AWS ${c.aws.price ?? 'N/D'} | GCP ${c.gcp.price ?? 'N/D'} | Azure ${c.azure.price ?? 'N/D'}`,
    )
    .join('\n');

  return `Com base nos dados abaixo, recomende o melhor provedor destino para migração.

Bill atual (${billing.provider}):
- Custo total: ${billing.currency} ${billing.totalCost}/mês
- Qualidade dos dados: ${billing.dataQuality}

Comparativo de preços verificados:
${summary}

Cobertura verificada: ${prices.meta.coveredCostPct}% do custo total
Serviços verificados: ${prices.meta.verifiedServices}/${prices.meta.analyzedServices}

Retorne JSON no formato exato:
{
  "recommendation": {
    "provider": "GCP|AZURE|OCI|AWS",
    "basedOnVerified": true,
    "migrationComplexity": "low|medium|high",
    "reasons": ["<razão 1>", "<razão 2>"],
    "topServices": ["<serviço 1>", "<serviço 2>"],
    "cfa_justification": "<justificativa financeira detalhada>"
  },
  "insights": ["<insight 1>", "<insight 2>"],
  "summary": "<resumo executivo em 2-3 frases>"
}`;
}

function fallbackRecommendation(): RecommendationResult {
  return {
    recommendation: {
      provider: 'GCP',
      basedOnVerified: false,
      migrationComplexity: 'medium',
      reasons: ['Dados insuficientes para recomendação precisa'],
      topServices: [],
      cfa_justification: 'Análise indisponível — verifique a chave da API Anthropic.',
    },
    insights: [],
    summary: 'Não foi possível gerar recomendação.',
  };
}
