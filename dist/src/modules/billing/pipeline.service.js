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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineService = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const claude_service_1 = require("./ai/claude.service");
const deterministic_mapping_service_1 = require("./mapping/deterministic-mapping.service");
const pricing_orchestrator_service_1 = require("./pricing/pricing-orchestrator.service");
let PipelineService = class PipelineService {
    claude;
    mapping;
    pricing;
    constructor(claude, mapping, pricing) {
        this.claude = claude;
        this.mapping = mapping;
        this.pricing = pricing;
    }
    runStream(billing) {
        return new rxjs_1.Observable((subscriber) => {
            (async () => {
                try {
                    const billingNormalized = normalizeBilling(billing);
                    const partial = { billing: billingNormalized };
                    subscriber.next({ step: 'mapping', message: `Mapeando ${billingNormalized.topServices.length} serviços pelo catálogo...` });
                    partial.mappings = await this.mapping.mapServices(billingNormalized);
                    subscriber.next({
                        step: 'mapping',
                        message: `${partial.mappings.mappings.length - partial.mappings.unmapped.length} serviços mapeados; ${partial.mappings.unmapped.length} sem equivalência`,
                        data: { mappings: partial.mappings },
                    });
                    subscriber.next({ step: 'pricing', message: 'Calculando preços do catálogo versionado...' });
                    partial.prices = await this.pricing.fetchPrices(billingNormalized, partial.mappings);
                    subscriber.next({
                        step: 'classification',
                        message: `${partial.prices.meta.verifiedServices} serviços verificados (${partial.prices.meta.coveredCostPct}% de cobertura)`,
                        data: { prices: partial.prices },
                    });
                    subscriber.next({
                        step: 'recommendation',
                        message: 'Calculando recomendação com dados verificados...',
                    });
                    partial.recommendation = await this.claude.generateRecommendation(billingNormalized, partial.prices);
                    subscriber.next({
                        step: 'recommendation',
                        message: partial.recommendation.recommendation.provider === billingNormalized.provider
                            ? `Recomendação: manter ${billingNormalized.provider}`
                            : `Recomendação: migrar para ${partial.recommendation.recommendation.provider}`,
                        data: { recommendation: partial.recommendation },
                    });
                    partial.payback = calculatePayback(billingNormalized, partial.prices, partial.recommendation);
                    const meta = {
                        ...partial.prices.meta,
                        analysisDate: new Date().toISOString(),
                    };
                    const result = {
                        meta,
                        billing: billingNormalized,
                        mappings: partial.mappings,
                        prices: partial.prices,
                        recommendation: partial.recommendation,
                        payback: partial.payback,
                    };
                    subscriber.next({
                        step: 'done',
                        message: 'Análise concluída',
                        data: result,
                    });
                    subscriber.complete();
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'Erro desconhecido';
                    subscriber.next({ step: 'error', message });
                    subscriber.complete();
                }
            })();
        });
    }
};
exports.PipelineService = PipelineService;
exports.PipelineService = PipelineService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [claude_service_1.ClaudeService,
        deterministic_mapping_service_1.DeterministicMappingService,
        pricing_orchestrator_service_1.PricingOrchestratorService])
], PipelineService);
const NON_TECHNICAL_SERVICES = new Set([
    'tax', 'support', 'credits', 'refund', 'discount',
]);
const SERVICE_NAME_MAP = {
    'ec2-instances': 'Amazon EC2',
    'ec2-other': 'Amazon EC2 (EBS/NAT/Transfer)',
    'rds': 'Amazon RDS',
    'relational database service': 'Amazon RDS',
    's3': 'Amazon S3',
    'elastic container service for kubernetes': 'Amazon EKS',
    'eks': 'Amazon EKS',
    'elastic container service': 'Amazon ECS',
    'ecs': 'Amazon ECS',
    'elastic load balancing': 'Amazon Elastic Load Balancing',
    'elb': 'Amazon Elastic Load Balancing',
    'vpc': 'Amazon VPC',
    'cloudwatch': 'Amazon CloudWatch',
    'opensearch service': 'Amazon OpenSearch',
    'elasticsearch service': 'Amazon OpenSearch',
    'documentdb (with mongodb compatibility)': 'Amazon DocumentDB',
    'documentdb': 'Amazon DocumentDB',
};
function normalizeBilling(billing) {
    const normalizedLineItems = (billing.lineItems ?? [])
        .filter((item) => item.provider === billing.provider &&
        item.currency === billing.currency &&
        isTechnicalService(item.serviceName ?? item.serviceCode))
        .map((item, index) => ({
        ...item,
        sourceKey: item.sourceKey ?? buildLineItemKey(item, index),
    }));
    const filtered = normalizedLineItems.length
        ? normalizedLineItems
            .map((item, index) => lineItemToTopService(item, index, billing.totalCost))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 25)
        : (billing.topServices ?? [])
            .filter((s) => {
            return isTechnicalService(s.name);
        })
            .map((s) => {
            const lower = (s.name ?? '').toLowerCase().trim();
            const canonical = SERVICE_NAME_MAP[lower];
            return {
                ...s,
                name: canonical ?? s.name ?? 'Serviço desconhecido',
                specs: s.specs ?? 'specs não informado',
                quantity: s.quantity ?? 'qtd não informada',
            };
        })
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 6);
    return {
        ...billing,
        targetRegion: billing.targetRegion ?? undefined,
        topServices: filtered,
        lineItems: normalizedLineItems.length ? normalizedLineItems : billing.lineItems,
    };
}
function lineItemToTopService(item, index, totalCost) {
    const attributes = item.attributes ?? {};
    const serviceName = item.serviceName ?? item.serviceCode;
    const nativeIdentity = item.nativeSkuName ?? item.skuId ?? item.meterId ?? item.usageType ?? `item-${index + 1}`;
    const operatingSystem = stringAttribute(attributes, [
        'operatingSystem',
        'operating_system',
        'os',
    ]);
    const architecture = stringAttribute(attributes, [
        'architecture',
        'processorArchitecture',
    ]);
    return {
        sourceLineItemKey: item.sourceKey,
        name: `${serviceName} — ${nativeIdentity}`,
        specs: [
            item.nativeSkuName,
            item.usageType,
            item.operation,
            item.region,
            operatingSystem,
            architecture,
        ]
            .filter(Boolean)
            .join(', '),
        cost: item.cost,
        pct: totalCost > 0 ? Number(((item.cost / totalCost) * 100).toFixed(4)) : 0,
        quantity: `${item.quantity} ${item.unit}`,
        nativeSkuName: item.nativeSkuName,
        nativeProductId: item.nativeProductId,
        region: item.region,
        operatingSystem,
        architecture,
        vcpu: numericAttribute(attributes, ['vcpu', 'vcpus', 'cores']),
        memoryGiB: numericAttribute(attributes, ['memoryGiB', 'memory_gib', 'memory']),
        usageQuantity: item.quantity,
        usageUnit: item.unit,
    };
}
function buildLineItemKey(item, index) {
    return [
        item.provider,
        item.skuId ?? item.meterId ?? item.nativeSkuName ?? item.serviceCode,
        item.region,
        item.usageType ?? '',
        item.operation ?? '',
        index,
    ].join(':');
}
function isTechnicalService(value) {
    const lower = (value ?? '').toLowerCase().trim();
    return Boolean(lower) && !NON_TECHNICAL_SERVICES.has(lower);
}
function stringAttribute(attributes, keys) {
    for (const key of keys) {
        const value = attributes?.[key];
        if (typeof value === 'string' && value.trim())
            return value;
    }
    return undefined;
}
function numericAttribute(attributes, keys) {
    for (const key of keys) {
        const value = attributes?.[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string') {
            const parsed = Number(value.replace(',', '.').replace(/[^\d.-]/g, ''));
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return undefined;
}
function calculatePayback(billing, prices, recommendation) {
    const provider = recommendation.recommendation.provider;
    const noMigration = provider === billing.provider;
    const targetCoveredCost = noMigration
        ? 0
        : prices.classified
            .filter((price) => {
            const entry = providerEntry(price, provider);
            return (providerStatus(price, provider) === 'verified' &&
                (!entry.currency || entry.currency === billing.currency));
        })
            .reduce((sum, price) => sum + price.currentCost, 0);
    const targetCoveragePct = billing.totalCost > 0
        ? Math.min(100, Math.round((targetCoveredCost / billing.totalCost) * 100))
        : 0;
    const monthlySaving = noMigration ? 0 : prices.classified.reduce((acc, c) => {
        const target = providerEntry(c, provider);
        const status = providerStatus(c, provider);
        const sameCurrency = !target.currency || target.currency === billing.currency;
        return target.estimatedMonthly != null && status === 'verified' && sameCurrency
            ? acc + (c.currentCost - target.estimatedMonthly)
            : acc;
    }, 0);
    const migrationCost = noMigration ? 0 : billing.totalCost * 3;
    const paybackMonths = monthlySaving > 0 ? Math.ceil(migrationCost / monthlySaving) : 0;
    const roi = (months) => monthlySaving > 0
        ? Math.round(((monthlySaving * months - migrationCost) / migrationCost) * 100)
        : 0;
    return {
        payback: {
            basedOnVerified: recommendation.recommendation.basedOnVerified,
            coveredCostPct: targetCoveragePct,
            monthlySaving: Number(monthlySaving.toFixed(2)),
            migrationCost: Number(migrationCost.toFixed(2)),
            paybackMonths,
            roi12m: roi(12),
            roi24m: roi(24),
            roi36m: roi(36),
            breakEvenMonth: paybackMonths,
            disclaimer: noMigration
                ? 'Nenhuma migração foi recomendada com a cobertura atual do catálogo.'
                : targetCoveragePct < 70
                    ? `Atenção: apenas ${targetCoveragePct}% do custo possui equivalência e preço verificados no catálogo para ${provider}. Projeções são estimativas.`
                    : 'Projeções baseadas no catálogo versionado e em equivalências determinísticas.',
        },
    };
}
function providerEntry(price, provider) {
    if (provider === 'AWS')
        return price.aws;
    if (provider === 'GCP')
        return price.gcp;
    if (provider === 'AZURE')
        return price.azure;
    return price.oci;
}
function providerStatus(price, provider) {
    if (provider === 'AWS')
        return price.awsStatus;
    if (provider === 'GCP')
        return price.gcpStatus;
    if (provider === 'AZURE')
        return price.azureStatus;
    return price.ociStatus;
}
//# sourceMappingURL=pipeline.service.js.map