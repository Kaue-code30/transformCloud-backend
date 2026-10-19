"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ClaudeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
let ClaudeService = ClaudeService_1 = class ClaudeService {
    config;
    logger = new common_1.Logger(ClaudeService_1.name);
    client;
    enabled;
    model = 'claude-opus-4-7';
    systemPrompt = `Você é um especialista em migração de infraestrutura cloud.
Você recebe uma decisão calculada por código a partir de um catálogo versionado.
Seu papel é somente explicar a decisão, seus riscos e limitações de forma clara.
Não altere o provedor escolhido, preços, SKUs, regiões, cobertura ou cálculos recebidos.

Responda SEMPRE em JSON válido conforme o schema solicitado. Sem texto extra fora do JSON.`;
    constructor(config) {
        this.config = config;
        const apiKey = this.config.get('ANTHROPIC_API_KEY');
        this.enabled = Boolean(apiKey && !apiKey.includes('COLOQUE_SUA_CHAVE'));
        if (!this.enabled) {
            this.logger.warn('ANTHROPIC_API_KEY não configurada — a recomendação usará texto determinístico.');
        }
        this.client = new sdk_1.default({ apiKey: apiKey ?? '' });
    }
    async generateRecommendation(billing, prices) {
        const decision = calculateRecommendation(billing, prices);
        if (!this.enabled)
            return decision;
        const prompt = buildRecommendationPrompt(billing, prices, decision);
        const raw = await this.ask(prompt, 2048);
        if (!raw)
            return decision;
        const parsed = safeParseJson(raw);
        if (!parsed || !isRecommendationShape(parsed)) {
            this.logger.error('Resposta de recomendação não é JSON válido');
            return decision;
        }
        return {
            ...parsed,
            recommendation: {
                ...parsed.recommendation,
                provider: decision.recommendation.provider,
                basedOnVerified: decision.recommendation.basedOnVerified,
                migrationComplexity: decision.recommendation.migrationComplexity,
                migrationComplexityDetails: decision.recommendation.migrationComplexityDetails,
            },
        };
    }
    async ask(prompt, maxTokens) {
        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: maxTokens,
                system: [
                    {
                        type: 'text',
                        text: this.systemPrompt,
                        cache_control: { type: 'ephemeral' },
                    },
                ],
                messages: [{ role: 'user', content: prompt }],
            });
            const block = response.content.find((b) => b.type === 'text');
            if (!block || block.type !== 'text')
                return null;
            this.logger.debug(`Tokens — input: ${response.usage.input_tokens} | output: ${response.usage.output_tokens} | cache_read: ${response.usage.cache_read_input_tokens ?? 0}`);
            return block.text;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro na chamada Claude: ${msg}`);
            return null;
        }
    }
};
exports.ClaudeService = ClaudeService;
exports.ClaudeService = ClaudeService = ClaudeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ClaudeService);
function safeParseJson(text) {
    if (!text)
        return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
        return null;
    try {
        return JSON.parse(match[0]);
    }
    catch {
        return null;
    }
}
function buildRecommendationPrompt(billing, prices, decision) {
    const summary = prices.classified
        .map((c) => `- ${c.service}: atual ${billing.currency} ${c.currentCost} | AWS ${formatMonthly(c.aws)} (${c.awsStatus}) | GCP ${formatMonthly(c.gcp)} (${c.gcpStatus}) | Azure ${formatMonthly(c.azure)} (${c.azureStatus}) | OCI ${formatMonthly(c.oci)} (${c.ociStatus})`)
        .join('\n');
    return `Explique a decisão de migração já calculada abaixo.
Não escolha outro provedor e não altere valores.

Bill atual (${billing.provider}):
- Custo total: ${billing.currency} ${billing.totalCost}/mês
- Qualidade dos dados: ${billing.dataQuality}

DECISÃO CALCULADA PELO SISTEMA:
- Provedor: ${decision.recommendation.provider}
- Baseada em cobertura suficiente: ${decision.recommendation.basedOnVerified}
- Complexidade por compatibilidade de catálogo: ${decision.recommendation.migrationComplexity}
- Evidência da complexidade: ${decision.recommendation.migrationComplexityDetails.summary}
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
    "migrationComplexity": "${decision.recommendation.migrationComplexity}",
    "reasons": ["<razão 1>", "<razão 2>"],
    "topServices": ["<serviço 1>", "<serviço 2>"],
    "cfa_justification": "<justificativa financeira detalhada>"
  },
  "insights": ["<insight 1>", "<insight 2>"],
  "summary": "<resumo executivo em 2-3 frases>"
}`;
}
function calculateRecommendation(billing, prices) {
    const providers = ['AWS', 'GCP', 'AZURE', 'OCI'].filter((provider) => provider !== billing.provider);
    const candidates = providers
        .map((provider) => calculateProviderCandidate(billing, prices.classified, provider))
        .filter((candidate) => candidate !== null)
        .sort((a, b) => a.projectedTotal - b.projectedTotal || b.coveredCostPct - a.coveredCostPct);
    const best = candidates[0];
    if (!best || best.monthlySaving <= 0) {
        const complexity = assessMigrationComplexity(billing, prices.classified, billing.provider, false);
        return {
            recommendation: {
                provider: billing.provider,
                basedOnVerified: false,
                migrationComplexity: complexity.level,
                migrationComplexityDetails: complexity.details,
                reasons: ['O catálogo não demonstrou economia verificável suficiente para recomendar migração'],
                topServices: [],
                cfa_justification: 'Manter o provedor atual até que exista cobertura de preço suficiente e economia positiva.',
            },
            insights: ['Itens sem equivalência não foram estimados nem preenchidos por IA.'],
            summary: 'Nenhuma migração é recomendada com os dados atualmente verificados.',
        };
    }
    const basedOnVerified = best.coveredCostPct >= 70;
    const complexity = assessMigrationComplexity(billing, prices.classified, best.provider, true);
    return {
        recommendation: {
            provider: best.provider,
            basedOnVerified,
            migrationComplexity: complexity.level,
            migrationComplexityDetails: complexity.details,
            reasons: [
                `Economia mensal verificada de ${billing.currency} ${best.monthlySaving.toFixed(2)}`,
                `Cobertura de ${best.coveredCostPct}% do custo total`,
            ],
            topServices: best.services,
            cfa_justification: `Custo projetado de ${billing.currency} ${best.projectedTotal.toFixed(2)}/mês, ` +
                `mantendo sem alteração os itens ainda não cobertos pelo catálogo.`,
        },
        insights: basedOnVerified
            ? ['A decisão usa apenas ofertas e preços vigentes no catálogo local.']
            : ['A cobertura é inferior a 70%; valide os itens sem equivalência antes da decisão final.'],
        summary: `O ranking determinístico indica ${best.provider} com ${best.coveredCostPct}% de cobertura.`,
    };
}
function assessMigrationComplexity(billing, prices, provider, isMigration) {
    const disclaimer = 'Estimativa baseada na compatibilidade e nos preços do catálogo; não avalia código, dependências da aplicação ou esforço de refatoração.';
    if (!isMigration) {
        return {
            level: 'low',
            details: {
                basis: 'catalog_compatibility',
                isMigration: false,
                summary: 'O cenário recomendado mantém o provedor atual; não há migração a avaliar.',
                verifiedServices: prices.length,
                totalServices: prices.length,
                coveredCostPct: 100,
                attentionPoints: [],
                disclaimer,
            },
        };
    }
    const verified = prices.filter((price) => providerSnapshot(price, provider).status === 'verified');
    const attentionPoints = prices.flatMap((price) => {
        const snapshot = providerSnapshot(price, provider);
        if (snapshot.status === 'verified')
            return [];
        return [{
                service: price.service,
                status: snapshot.status,
                reason: snapshot.entry.reason ?? statusReason(snapshot.status, provider),
            }];
    });
    const coveredCost = verified.reduce((sum, price) => sum + price.currentCost, 0);
    const coveredCostPct = billing.totalCost > 0
        ? Math.min(100, Math.round((coveredCost / billing.totalCost) * 100))
        : 0;
    const level = attentionPoints.length === 0
        ? 'low'
        : verified.length === 0
            ? 'high'
            : 'medium';
    const summary = attentionPoints.length === 0
        ? `${verified.length} de ${prices.length} serviços têm equivalência e preço verificados em ${provider}.`
        : verified.length === 0
            ? `Nenhum dos ${prices.length} serviços tem equivalência e preço verificados em ${provider}.`
            : `${verified.length} de ${prices.length} serviços têm equivalência e preço verificados em ${provider}; ${attentionPoints.length} exigem validação.`;
    return {
        level,
        details: {
            basis: 'catalog_compatibility',
            isMigration: true,
            summary,
            verifiedServices: verified.length,
            totalServices: prices.length,
            coveredCostPct,
            attentionPoints,
            disclaimer,
        },
    };
}
function statusReason(status, provider) {
    if (status === 'partial') {
        return `Equivalência em ${provider} encontrada, mas ainda não totalmente verificada.`;
    }
    if (status === 'no_api') {
        return `Preço de ${provider} indisponível para verificação automática.`;
    }
    return `Sem equivalência e preço verificados em ${provider}.`;
}
function calculateProviderCandidate(billing, prices, provider) {
    const covered = prices.filter((price) => {
        const snapshot = providerSnapshot(price, provider);
        return (snapshot.status === 'verified' &&
            snapshot.entry.estimatedMonthly != null &&
            (!snapshot.entry.currency || snapshot.entry.currency === billing.currency));
    });
    if (!covered.length)
        return null;
    const currentCovered = covered.reduce((sum, price) => sum + price.currentCost, 0);
    const targetCovered = covered.reduce((sum, price) => sum + (providerSnapshot(price, provider).entry.estimatedMonthly ?? 0), 0);
    const monthlySaving = currentCovered - targetCovered;
    return {
        provider,
        coveredCostPct: billing.totalCost > 0
            ? Math.min(100, Math.round((currentCovered / billing.totalCost) * 100))
            : 0,
        monthlySaving,
        projectedTotal: billing.totalCost - monthlySaving,
        services: covered.map((price) => price.service),
    };
}
function providerSnapshot(price, provider) {
    if (provider === 'AWS')
        return { entry: price.aws, status: price.awsStatus };
    if (provider === 'GCP')
        return { entry: price.gcp, status: price.gcpStatus };
    if (provider === 'AZURE')
        return { entry: price.azure, status: price.azureStatus };
    return { entry: price.oci, status: price.ociStatus };
}
function formatMonthly(entry) {
    return entry.estimatedMonthly == null
        ? 'N/D'
        : `${entry.currency ?? '?'} ${entry.estimatedMonthly}`;
}
function isRecommendationShape(value) {
    return Boolean(value?.recommendation &&
        Array.isArray(value.recommendation.reasons) &&
        Array.isArray(value.recommendation.topServices) &&
        Array.isArray(value.insights) &&
        typeof value.summary === 'string');
}
//# sourceMappingURL=claude.service.js.map