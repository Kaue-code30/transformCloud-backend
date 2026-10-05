"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcpCatalogAdapter = void 0;
const common_1 = require("@nestjs/common");
let GcpCatalogAdapter = class GcpCatalogAdapter {
    baseUrl = 'https://cloudbilling.googleapis.com/v1';
    async download(options) {
        if (!options.apiKey || !options.service || !options.region) {
            throw new common_1.BadRequestException('apiKey, service e region são obrigatórios');
        }
        const service = await this.resolveService(options.service, options.apiKey);
        const skus = await this.listSkus(service.name, options.apiKey, options.maxScanSkus ?? 50_000);
        return this.toSnapshot(service, skus, options);
    }
    toSnapshot(service, skus, options) {
        const services = new Map();
        const offerings = [];
        const meters = [];
        const offeringMeters = [];
        const needle = options.match?.toLowerCase();
        const requestedSkuIds = new Set((options.skuIds ?? []).map((skuId) => skuId.trim().toUpperCase()));
        const normalized = [];
        for (const sku of skus) {
            if (normalized.length >= (options.maxSkus ?? 500))
                break;
            if (requestedSkuIds.size &&
                !requestedSkuIds.has(sku.skuId.toUpperCase())) {
                continue;
            }
            if (needle && !JSON.stringify(sku).toLowerCase().includes(needle)) {
                continue;
            }
            if (!supportsRegion(sku.serviceRegions, options.region) ||
                !isOnDemandSku(sku)) {
                continue;
            }
            const resourceKind = options.resourceKind ?? resourceKindFor(service.displayName, sku);
            if (!resourceKind)
                continue;
            const pricing = latestPricing(sku.pricingInfo);
            const expression = pricing?.pricingExpression;
            const tiers = (expression?.tieredRates ?? [])
                .map((tier) => ({
                startQuantity: Number(tier.startUsageAmount ?? 0),
                unitPrice: money(tier.unitPrice),
            }))
                .filter((tier) => Number.isFinite(tier.unitPrice));
            if (!pricing?.effectiveTime || !expression?.usageUnit || !tiers.length) {
                continue;
            }
            normalized.push({ sku, resourceKind, pricing, expression, tiers });
        }
        if (!normalized.length) {
            throw new common_1.BadRequestException('Nenhum SKU GCP compatível encontrado');
        }
        if (requestedSkuIds.size) {
            const importedSkuIds = new Set(normalized.map((item) => item.sku.skuId.toUpperCase()));
            const missingSkuIds = [...requestedSkuIds].filter((skuId) => !importedSkuIds.has(skuId));
            if (missingSkuIds.length) {
                throw new common_1.BadRequestException(`SKUs GCP solicitados não encontrados ou incompatíveis: ${missingSkuIds.join(', ')}`);
            }
        }
        const groups = options.offeringName
            ? [normalized]
            : normalized.map((item) => [item]);
        for (const group of groups) {
            const first = group[0];
            const resourceKind = first.resourceKind;
            if (group.some((item) => item.resourceKind !== resourceKind)) {
                throw new common_1.BadRequestException('Uma oferta composta GCP não pode misturar tipos de recurso');
            }
            const serviceNativeCode = `${service.serviceId}:${resourceKind}`;
            services.set(serviceNativeCode, {
                nativeCode: serviceNativeCode,
                name: service.displayName,
                resourceKind,
            });
            const offeringKey = options.offeringName
                ? `GCP_CATALOG:COMPOSITE:${service.serviceId}:${options.region}:${slug(options.offeringName)}`
                : `GCP_CATALOG:${first.sku.skuId}:${options.region}`;
            const nativeSkuName = options.offeringName ?? first.sku.description;
            offerings.push({
                sourceKey: offeringKey,
                serviceNativeCode,
                nativeProductId: group.map((item) => item.sku.skuId).join('+'),
                nativeSkuName,
                displayName: nativeSkuName,
                region: options.region,
                purchaseOption: 'ON_DEMAND',
                operatingSystem: options.operatingSystem,
                architecture: options.architecture,
                engine: options.engine ??
                    (resourceKind === 'MANAGED_POSTGRES'
                        ? 'PostgreSQL'
                        : resourceKind === 'MANAGED_MYSQL'
                            ? 'MySQL'
                            : undefined),
                vcpu: options.vcpu,
                memoryGiB: options.memoryGiB,
                attributes: {
                    composite: group.length > 1,
                    skuIds: group.map((item) => item.sku.skuId),
                    serviceRegions: first.sku.serviceRegions ?? [],
                },
                rawSource: {
                    composite: group.length > 1,
                    skus: group.map((item) => item.sku),
                },
            });
            for (const item of group) {
                const meterKey = `GCP_CATALOG:METER:${item.sku.skuId}:${options.region}:${item.pricing.effectiveTime}`;
                meters.push({
                    sourceKey: meterKey,
                    serviceNativeCode,
                    nativeSkuId: item.sku.skuId,
                    nativeMeterId: item.sku.name,
                    name: item.expression.usageUnitDescription ?? item.sku.description,
                    region: options.region,
                    pricingUnit: item.expression.usageUnit,
                    unitMultiplier: 1,
                    currency: pricingCurrency(item.expression.tieredRates) ?? 'USD',
                    priceType: 'ON_DEMAND',
                    effectiveFrom: item.pricing.effectiveTime,
                    attributes: {
                        catalogSource: 'GCP_CLOUD_BILLING_CATALOG_API',
                        baseUnit: item.expression.baseUnit ?? '',
                        baseUnitConversionFactor: item.expression.baseUnitConversionFactor ?? 1,
                        resourceGroup: item.sku.category?.resourceGroup ?? '',
                        usageType: item.sku.category?.usageType ?? '',
                    },
                    rawSource: item.pricing,
                    tiers: item.tiers,
                });
                offeringMeters.push({
                    offeringSourceKey: offeringKey,
                    meterSourceKey: meterKey,
                    quantity: componentQuantity(item.sku, options),
                });
            }
        }
        return {
            provider: 'GCP',
            source: 'GCP_CLOUD_BILLING_CATALOG_API',
            version: newestEffective(meters),
            mode: 'PARTIAL',
            services: [...services.values()],
            offerings,
            meters,
            offeringMeters,
        };
    }
    async resolveService(query, apiKey) {
        let pageToken = '';
        const normalized = normalizeServiceName(query);
        do {
            const url = new URL(`${this.baseUrl}/services`);
            url.searchParams.set('pageSize', '5000');
            if (pageToken)
                url.searchParams.set('pageToken', pageToken);
            const data = await this.fetchJson(url, apiKey);
            const found = data.services?.find((item) => item.serviceId === query ||
                item.name === query ||
                item.displayName.toLowerCase() === normalized);
            if (found)
                return found;
            pageToken = data.nextPageToken ?? '';
        } while (pageToken);
        throw new common_1.BadRequestException(`Serviço GCP não encontrado: ${query}`);
    }
    async listSkus(serviceName, apiKey, max) {
        const result = [];
        let pageToken = '';
        do {
            const url = new URL(`${this.baseUrl}/${serviceName}/skus`);
            url.searchParams.set('pageSize', String(Math.min(5000, max)));
            if (pageToken)
                url.searchParams.set('pageToken', pageToken);
            const data = await this.fetchJson(url, apiKey);
            result.push(...(data.skus ?? []));
            pageToken = data.nextPageToken ?? '';
        } while (pageToken && result.length < max);
        return result.slice(0, max);
    }
    async fetchJson(url, apiKey) {
        const response = await fetch(url, {
            headers: { 'x-goog-api-key': apiKey },
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            const body = (await response.json().catch(() => null));
            const detail = body?.error?.message ?? body?.error?.status ?? 'sem detalhes';
            throw new common_1.BadGatewayException(`GCP Catalog retornou HTTP ${response.status}: ${detail}`);
        }
        return response.json();
    }
};
exports.GcpCatalogAdapter = GcpCatalogAdapter;
exports.GcpCatalogAdapter = GcpCatalogAdapter = __decorate([
    (0, common_1.Injectable)()
], GcpCatalogAdapter);
function normalizeServiceName(value) {
    const normalized = value.toLowerCase().trim();
    const aliases = {
        'cloud functions': 'cloud run functions',
    };
    return aliases[normalized] ?? normalized;
}
function resourceKindFor(service, sku) {
    const text = `${service} ${sku.description} ${sku.category?.resourceFamily ?? ''}`.toLowerCase();
    if (text.includes('network') &&
        (text.includes('egress') ||
            text.includes('data transfer') ||
            text.includes('internet')))
        return 'DATA_TRANSFER';
    if (text.includes('cloud sql') && text.includes('postgres')) {
        return 'MANAGED_POSTGRES';
    }
    if (text.includes('cloud sql') && text.includes('mysql')) {
        return 'MANAGED_MYSQL';
    }
    if (text.includes('cloud storage') ||
        (text.includes('storage') && text.includes('byte')))
        return 'OBJECT_STORAGE';
    if (text.includes('cloud function') || text.includes('functions')) {
        return 'SERVERLESS_FUNCTION';
    }
    if (text.includes('cloud logging') || text.includes('log ingestion')) {
        return 'OBSERVABILITY_LOGS';
    }
    if (text.includes('compute engine') &&
        (text.includes('core') ||
            text.includes('ram') ||
            text.includes('instance')))
        return 'COMPUTE_VM';
    return null;
}
function supportsRegion(regions, region) {
    return (!regions?.length || regions.includes(region) || regions.includes('global'));
}
function isOnDemandSku(sku) {
    const usageType = sku.category?.usageType;
    if (!usageType)
        return true;
    return usageType.toLowerCase().replace(/[^a-z]/g, '') === 'ondemand';
}
function componentQuantity(sku, options) {
    const text = `${sku.description} ${sku.category?.resourceGroup ?? ''}`.toLowerCase();
    if (/\b(core|cpu|vcpu)\b/.test(text) && options.vcpu)
        return options.vcpu;
    if (/\b(ram|memory)\b/.test(text) && options.memoryGiB) {
        return options.memoryGiB;
    }
    return 1;
}
function latestPricing(items) {
    return [...(items ?? [])].sort((a, b) => (b.effectiveTime ?? '').localeCompare(a.effectiveTime ?? ''))[0];
}
function money(value) {
    return (Number(value?.units ?? 0) + Number(value?.nanos ?? 0) / 1_000_000_000);
}
function pricingCurrency(rates) {
    return rates?.map((rate) => rate.unitPrice?.currencyCode).find(Boolean);
}
function newestEffective(meters) {
    return meters.map((meter) => meter.effectiveFrom).sort().at(-1);
}
function slug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
//# sourceMappingURL=gcp-catalog.adapter.js.map