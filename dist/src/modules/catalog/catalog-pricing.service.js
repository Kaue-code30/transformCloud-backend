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
exports.CatalogPricingService = void 0;
const common_1 = require("@nestjs/common");
const catalog_repository_1 = require("./catalog.repository");
let CatalogPricingService = class CatalogPricingService {
    catalog;
    constructor(catalog) {
        this.catalog = catalog;
    }
    async calculate(offeringId, usageQuantity) {
        if (!Number.isFinite(usageQuantity) || usageQuantity <= 0)
            return null;
        const offering = await this.catalog.getOfferingWithPrices(offeringId);
        if (!offering?.meters.length)
            return null;
        const now = new Date();
        const components = offering.meters.filter(({ meter }) => meter.effectiveFrom <= now && (!meter.effectiveTo || meter.effectiveTo > now));
        if (!components.length)
            return null;
        const currencies = new Set(components.map(({ meter }) => meter.currency));
        if (currencies.size !== 1)
            return null;
        let estimatedCost = 0;
        for (const component of components) {
            const componentUsage = usageQuantity * component.quantity.toNumber();
            const multiplier = component.meter.unitMultiplier.toNumber();
            if (multiplier <= 0 || !component.meter.tiers.length)
                return null;
            estimatedCost += calculateTieredCost(componentUsage / multiplier, component.meter.tiers.map((tier) => ({
                start: tier.startQuantity.toNumber(),
                end: tier.endQuantity?.toNumber() ?? null,
                price: tier.unitPrice.toNumber(),
            })));
        }
        const effectiveFrom = components
            .map(({ meter }) => meter.effectiveFrom)
            .sort((a, b) => b.getTime() - a.getTime())[0];
        return {
            unitPrice: Number((estimatedCost / usageQuantity).toFixed(10)),
            estimatedCost: Number(estimatedCost.toFixed(2)),
            unit: components.map(({ meter }) => meter.pricingUnit).join(' + '),
            currency: components[0].meter.currency,
            source: meterCatalogSource(components[0].meter.attributes) ??
                `Catálogo local versionado (${offering.provider}/${offering.nativeSkuName})`,
            effectiveFrom: effectiveFrom.toISOString(),
        };
    }
};
exports.CatalogPricingService = CatalogPricingService;
exports.CatalogPricingService = CatalogPricingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [catalog_repository_1.CatalogRepository])
], CatalogPricingService);
function meterCatalogSource(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    const source = value.catalogSource;
    return typeof source === 'string' && source ? source : null;
}
function calculateTieredCost(usage, tiers) {
    const ordered = [...tiers].sort((a, b) => a.start - b.start);
    let total = 0;
    for (let index = 0; index < ordered.length; index++) {
        const tier = ordered[index];
        const nextStart = ordered[index + 1]?.start ?? Number.POSITIVE_INFINITY;
        const end = tier.end ?? nextStart;
        const billable = Math.max(0, Math.min(usage, end) - tier.start);
        total += billable * tier.price;
        if (usage <= end)
            break;
    }
    return total;
}
//# sourceMappingURL=catalog-pricing.service.js.map