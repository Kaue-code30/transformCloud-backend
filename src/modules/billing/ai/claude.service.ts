import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ParsedBilling,
  ClassificationResult,
  RecommendationResult,
  CloudProvider,
  ClassifiedPrice,
} from '../types/pipeline.types';

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic;
  private readonly enabled: boolean;
  private readonly model = 'claude-opus-4-7';

  // System prompt estável — cacheado entre requisições (prompt caching)
  private readonly systemPrompt = `Você é um especialista em migração de infraestrutura cloud.
Você recebe uma decisão calculada por código a partir de um catálogo versionado.
Seu papel é somente explicar a decisão, seus riscos e limitações de forma clara.
Não altere o provedor escolhido, preços, SKUs, regiões, cobertura ou cálculos recebidos.

Responda SEMPRE em JSON válido conforme o schema solicitado. Sem texto extra fora do JSON.`;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.enabled = Boolean(apiKey && !apiKey.includes('COLOQUE_SUA_CHAVE'));
    if (!this.enabled) {
      this.logger.warn('ANTHROPIC_API_KEY não configurada — a recomendação usará texto determinístico.');
    }
    this.client = new Anthropic({ apiKey: apiKey ?? '' });
  }

  // ─── Etapa 5: redação da recomendação calculada ───────────────────────────

  async generateRecommendation(
    billing: ParsedBilling,
    prices: ClassificationResult,
  ): Promise<RecommendationResult> {
    const decision = calculateRecommendation(billing, prices);
    if (!this.enabled) return decision;
    const prompt = buildRecommendationPrompt(billing, prices, decision);

    const raw = await this.ask(prompt, 2048);
    if (!raw) return decision;

    const parsed = safeParseJson<RecommendationResult>(raw);
    if (!parsed || !isRecommendationShape(parsed)) {
      this.logger.error('Resposta de recomendação não é JSON válido');
      return decision;
    }

    // A IA pode redigir, mas não pode modificar a decisão calculada.
    return {
      ...parsed,
      recommendation: {
        ...parsed.recommendation,
        provider: decision.recommendation.provider,
        basedOnVerified: decision.recommendation.basedOnVerified,
      },
    };
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

function buildRecommendationPrompt(
  billing: ParsedBilling,
  prices: ClassificationResult,
  decision: RecommendationResult,
): string {
  const summary = prices.classified
    .map(
      (c) =>
        `- ${c.service}: atual ${billing.currency} ${c.currentCost} | AWS ${formatMonthly(c.aws)} (${c.awsStatus}) | GCP ${formatMonthly(c.gcp)} (${c.gcpStatus}) | Azure ${formatMonthly(c.azure)} (${c.azureStatus}) | OCI ${formatMonthly(c.oci)} (${c.ociStatus})`,
    )
    .join('\n');

  return `Explique a decisão de migração já calculada abaixo.
Não escolha outro provedor e não altere valores.

Bill atual (${billing.provider}):
- Custo total: ${billing.currency} ${billing.totalCost}/mês
- Qualidade dos dados: ${billing.dataQuality}

DECISÃO CALCULADA PELO SISTEMA:
- Provedor: ${decision.recommendation.provider}
- Baseada em cobertura suficiente: ${decision.recommendation.basedOnVerified}
- Justificativa calculada: ${decision.recommendation.cfa_justification}

Comparativo mensal do catálogo:
${summary}

Cobertura verificada: ${prices.meta.coveredCostPct}% do custo total
Serviços verificados: ${prices.meta.verifiedServices}/${prices.meta.analyzedServices}

Retorne JSON no formato exato:
{
  "recommendation": {
    "provider": "${decision.recommendation.provider}",
    "basedOnVerified": ${decision.recommendation.basedOnVerified},
    "migrationComplexity": "low|medium|high",
    "reasons": ["<razão 1>", "<razão 2>"],
    "topServices": ["<serviço 1>", "<serviço 2>"],
    "cfa_justification": "<justificativa financeira detalhada>"
  },
  "insights": ["<insight 1>", "<insight 2>"],
  "summary": "<resumo executivo em 2-3 frases>"
}`;
}

function calculateRecommendation(
  billing: ParsedBilling,
  prices: ClassificationResult,
): RecommendationResult {
  const providers = (['AWS', 'GCP', 'AZURE', 'OCI'] as CloudProvider[]).filter(
    (provider) => provider !== billing.provider,
  );
  const candidates = providers
    .map((provider) => calculateProviderCandidate(billing, prices.classified, provider))
    .filter((candidate): candidate is ProviderCandidate => candidate !== null)
    .sort((a, b) => a.projectedTotal - b.projectedTotal || b.coveredCostPct - a.coveredCostPct);
  const best = candidates[0];

  if (!best || best.monthlySaving <= 0) {
    return {
      recommendation: {
        provider: billing.provider,
        basedOnVerified: false,
        migrationComplexity: 'low',
        reasons: ['O catálogo não demonstrou economia verificável suficiente para recomendar migração'],
        topServices: [],
        cfa_justification: 'Manter o provedor atual até que exista cobertura de preço suficiente e economia positiva.',
      },
      insights: ['Itens sem equivalência não foram estimados nem preenchidos por IA.'],
      summary: 'Nenhuma migração é recomendada com os dados atualmente verificados.',
    };
  }

  const basedOnVerified = best.coveredCostPct >= 70;
  return {
    recommendation: {
      provider: best.provider,
      basedOnVerified,
      migrationComplexity: 'medium',
      reasons: [
        `Economia mensal verificada de ${billing.currency} ${best.monthlySaving.toFixed(2)}`,
        `Cobertura de ${best.coveredCostPct}% do custo total`,
      ],
      topServices: best.services,
      cfa_justification:
        `Custo projetado de ${billing.currency} ${best.projectedTotal.toFixed(2)}/mês, ` +
        `mantendo sem alteração os itens ainda não cobertos pelo catálogo.`,
    },
    insights: basedOnVerified
      ? ['A decisão usa apenas ofertas e preços vigentes no catálogo local.']
      : ['A cobertura é inferior a 70%; valide os itens sem equivalência antes da decisão final.'],
    summary: `O ranking determinístico indica ${best.provider} com ${best.coveredCostPct}% de cobertura.`,
  };
}

interface ProviderCandidate {
  provider: CloudProvider;
  coveredCostPct: number;
  monthlySaving: number;
  projectedTotal: number;
  services: string[];
}

function calculateProviderCandidate(
  billing: ParsedBilling,
  prices: ClassifiedPrice[],
  provider: CloudProvider,
): ProviderCandidate | null {
  const covered = prices.filter((price) => {
    const snapshot = providerSnapshot(price, provider);
    return (
      snapshot.status === 'verified' &&
      snapshot.entry.estimatedMonthly != null &&
      (!snapshot.entry.currency || snapshot.entry.currency === billing.currency)
    );
  });
  if (!covered.length) return null;

  const currentCovered = covered.reduce((sum, price) => sum + price.currentCost, 0);
  const targetCovered = covered.reduce(
    (sum, price) => sum + (providerSnapshot(price, provider).entry.estimatedMonthly ?? 0),
    0,
  );
  const monthlySaving = currentCovered - targetCovered;
  return {
    provider,
    coveredCostPct:
      billing.totalCost > 0
        ? Math.min(100, Math.round((currentCovered / billing.totalCost) * 100))
        : 0,
    monthlySaving,
    projectedTotal: billing.totalCost - monthlySaving,
    services: covered.map((price) => price.service),
  };
}

function providerSnapshot(price: ClassifiedPrice, provider: CloudProvider) {
  if (provider === 'AWS') return { entry: price.aws, status: price.awsStatus };
  if (provider === 'GCP') return { entry: price.gcp, status: price.gcpStatus };
  if (provider === 'AZURE') return { entry: price.azure, status: price.azureStatus };
  return { entry: price.oci, status: price.ociStatus };
}

function formatMonthly(entry: ClassifiedPrice['aws']): string {
  return entry.estimatedMonthly == null
    ? 'N/D'
    : `${entry.currency ?? '?'} ${entry.estimatedMonthly}`;
}

function isRecommendationShape(value: RecommendationResult): boolean {
  return Boolean(
    value?.recommendation &&
      Array.isArray(value.recommendation.reasons) &&
      Array.isArray(value.recommendation.topServices) &&
      Array.isArray(value.insights) &&
      typeof value.summary === 'string',
  );
}
