"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OciCatalogAdapter = void 0;
const common_1 = require("@nestjs/common");
let OciCatalogAdapter = class OciCatalogAdapter {
    baseUrl = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/';
    async download(options) {
        if (!options.region ||
            (!options.partNumber && !options.partNumbers?.length && !options.match)) {
            throw new common_1.BadRequestException('region e ao menos um filtro partNumber/partNumbers/match são obrigatórios');
        }
        const url = new URL(this.baseUrl);
        url.searchParams.set('currencyCode', options.currency ?? 'USD');
        if (options.partNumber && !options.partNumbers?.length) {
            url.searchParams.set('partNumber', options.partNumber);
        }
        const data = await this.fetchJson(url);
        return this.toSnapshot(data.items ?? [], options);
    }
    toSnapshot(products, options) {
        const currency = options.currency ?? 'USD';
        const needle = options.match?.toLowerCase();
        const requestedPartNumbers = new Set([options.partNumber, ...(options.partNumbers ?? [])]
            .filter((value) => Boolean(value))
            .map((value) => value.trim().toUpperCase()));
        const effectiveFrom = options.effectiveFrom ?? new Date().toISOString();
        const selected = products
            .filter((product) => {
            if (requestedPartNumbers.size &&
                !requestedPartNumbers.has(product.partNumber.toUpperCase())) {
                return false;
            }
            return (!needle || JSON.stringify(product).toLowerCase().includes(needle));
        })
            .slice(0, options.maxProducts ?? 500);
        const normalized = selected
            .map((product) => {
            const resourceKind = options.resourceKind ?? resourceKindFor(product);
            const prices = priceRanges(product, currency)
                .filter((price) => price.model === 'PAY_AS_YOU_GO')
                .map((price) => {
                const rangeMax = finiteNumber(price.rangeMax);
                return {
                    startQuantity: finiteNumber(price.rangeMin) ?? 0,
                    ...(rangeMax != null && rangeMax < 1_000_000_000_000
                        ? { endQuantity: rangeMax }
                        : {}),
                    unitPrice: finiteNumber(price.value),
                };
            })
                .filter((tier) => tier.unitPrice != null && tier.unitPrice >= 0)
                .sort((a, b) => a.startQuantity - b.startQuantity);
            return { product, resourceKind, prices };
        })
            .filter((item) => Boolean(item.resourceKind && item.prices.length));
        if (!normalized.length) {
            throw new common_1.BadRequestException('Nenhum preço OCI compatível encontrado para os filtros informados');
        }
        if (requestedPartNumbers.size) {
            const importedPartNumbers = new Set(normalized.map((item) => item.product.partNumber.toUpperCase()));
            const missingPartNumbers = [...requestedPartNumbers].filter((partNumber) => !importedPartNumbers.has(partNumber));
            if (missingPartNumbers.length) {
                throw new common_1.BadRequestException(`Part numbers OCI solicitados não encontrados ou incompatíveis: ${missingPartNumbers.join(', ')}`);
            }
        }
        const services = new Map();
        const offerings = [];
        const meters = [];
        const offeringMeters = [];
        const groups = options.offeringName
            ? [normalized]
            : normalized.map((item) => [item]);
        for (const group of groups) {
            const first = group[0];
            const resourceKind = first.resourceKind;
            if (group.some((item) => item.resourceKind !== resourceKind)) {
                throw new common_1.BadRequestException('Um offering composto da OCI não pode misturar tipos de recurso');
            }
            const serviceNativeCode = `OCI:${resourceKind}:${first.product.serviceCategory}`;
            services.set(serviceNativeCode, {
                nativeCode: serviceNativeCode,
                name: first.product.serviceCategory,
                resourceKind,
            });
            const partNumbers = group.map((item) => item.product.partNumber);
            const nativeSkuName = options.offeringName ?? first.product.displayName;
            const groupId = options.offeringName
                ? `${options.region}:${slug(options.offeringName)}`
                : `${options.region}:${first.product.partNumber}`;
            const offeringKey = `OCI_PRICE_LIST:${groupId}`;
            offerings.push({
                sourceKey: offeringKey,
                serviceNativeCode,
                nativeProductId: partNumbers.join('+'),
                nativeSkuName,
                displayName: options.offeringName ?? first.product.displayName,
                region: options.region,
                purchaseOption: 'ON_DEMAND',
                operatingSystem: options.operatingSystem,
                architecture: options.architecture,
                engine: options.engine ?? inferEngine(resourceKind),
                vcpu: options.vcpu,
                memoryGiB: options.memoryGiB,
                attributes: {
                    partNumbers,
                    serviceCategory: first.product.serviceCategory,
                    globalListPrice: true,
                },
                rawSource: {
                    composite: group.length > 1,
                    products: group.map((item) => item.product),
                },
            });
            for (const item of group) {
                const unit = normalizeOciUnit(item.product.metricName, item.resourceKind);
                const meterKey = `OCI_PRICE_LIST:METER:${item.product.partNumber}:${currency}:PAY_AS_YOU_GO`;
                meters.push({
                    sourceKey: meterKey,
                    serviceNativeCode,
                    nativeSkuId: item.product.partNumber,
                    nativeMeterId: item.product.partNumber,
                    name: `${item.product.displayName} — ${item.product.metricName}`,
                    region: options.region,
                    pricingUnit: unit.unit,
                    unitMultiplier: unit.multiplier,
                    currency,
                    priceType: 'ON_DEMAND',
                    effectiveFrom,
                    attributes: {
                        catalogSource: 'OCI_PUBLIC_PRICE_LIST_API',
                        metricName: item.product.metricName,
                        serviceCategory: item.product.serviceCategory,
                        globalListPrice: true,
                    },
                    rawSource: item.product,
                    tiers: item.prices,
                });
                offeringMeters.push({
                    offeringSourceKey: offeringKey,
                    meterSourceKey: meterKey,
                    quantity: componentQuantity(item.product.metricName, options),
                });
            }
        }
        return {
            provider: 'OCI',
            source: 'OCI_PUBLIC_PRICE_LIST_API',
            version: effectiveFrom,
            mode: 'PARTIAL',
            services: [...services.values()],
            offerings,
            meters,
            offeringMeters,
        };
    }
    async fetchJson(url) {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => 'sem detalhes');
            throw new common_1.BadGatewayException(`OCI Price List retornou HTTP ${response.status}: ${detail.slice(0, 300)}`);
        }
        return response.json();
    }
};
exports.OciCatalogAdapter = OciCatalogAdapter;
exports.OciCatalogAdapter = OciCatalogAdapter = __decorate([
    (0, common_1.Injectable)()
], OciCatalogAdapter);
function priceRanges(product, currency) {
    const localizations = product.currencyCodeLocalizations ?? product.prices ?? [];
    return (localizations.find((item) => item.currencyCode === currency)?.prices ?? []);
}
function resourceKindFor(product) {
    const text = [
        product.displayName,
        product.metricName,
        product.serviceCategory,
    ]
        .join(' ')
        .toLowerCase();
    if (text.includes('postgresql'))
        return 'MANAGED_POSTGRES';
    if (text.includes('mysql'))
        return 'MANAGED_MYSQL';
    if (text.includes('function'))
        return 'SERVERLESS_FUNCTION';
    if (text.includes('logging') || text.includes('log storage')) {
        return 'OBSERVABILITY_LOGS';
    }
    if (text.includes('outbound data transfer') ||
        text.includes('data transferred') ||
        text.includes('data transfer'))
        return 'DATA_TRANSFER';
    if (text.includes('object storage'))
        return 'OBJECT_STORAGE';
    if (product.serviceCategory.toLowerCase() === 'compute - virtual machine' ||
        text.includes('compute - standard'))
        return 'COMPUTE_VM';
    return null;
}
function normalizeOciUnit(metricName, kind) {
    const lower = metricName.toLowerCase();
    const multiplier = quantityPrefix(metricName);
    if (lower.includes('memory-second')) {
        return { unit: 'GB-Second', multiplier };
    }
    if (kind === 'DATA_TRANSFER' && lower.includes('gigabyte')) {
        return { unit: 'GB', multiplier };
    }
    if (lower.includes('gigabyte') &&
        (lower.includes('per month') || lower.includes('storage capacity'))) {
        return { unit: 'GB-Mo', multiplier };
    }
    if (lower.includes('gigabyte') && lower.includes('per hour')) {
        return { unit: 'Hrs', multiplier };
    }
    if (lower.includes('ocpu') && lower.includes('hour')) {
        return { unit: 'Hrs', multiplier };
    }
    if (lower.includes('request') || lower.includes('invocation')) {
        return { unit: 'Requests', multiplier };
    }
    if (lower.includes('hour'))
        return { unit: 'Hrs', multiplier };
    if (lower.includes('gigabyte'))
        return { unit: 'GB', multiplier };
    return { unit: metricName, multiplier };
}
function quantityPrefix(value) {
    const match = value.trim().match(/^([\d,.]+)\s*(MIL|[kKmM])?/i);
    if (!match)
        return 1;
    const number = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(number) || number <= 0)
        return 1;
    const suffix = match[2]?.toLowerCase();
    return number *
        (suffix === 'k' ? 1_000 : suffix === 'm' || suffix === 'mil' ? 1_000_000 : 1);
}
function componentQuantity(metricName, options) {
    const lower = metricName.toLowerCase();
    if (lower.includes('ocpu') && options.ocpu)
        return options.ocpu;
    if (lower.includes('gigabyte') &&
        lower.includes('per hour') &&
        options.memoryGiB) {
        return options.memoryGiB;
    }
    return 1;
}
function inferEngine(kind) {
    if (kind === 'MANAGED_POSTGRES')
        return 'PostgreSQL';
    if (kind === 'MANAGED_MYSQL')
        return 'MySQL';
    return undefined;
}
function finiteNumber(value) {
    if (value == null || value === '')
        return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
//# sourceMappingURL=oci-catalog.adapter.js.map