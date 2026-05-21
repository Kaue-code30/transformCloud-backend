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
var GcpPricingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcpPricingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const GCP_BILLING_API = 'https://cloudbilling.googleapis.com/v1/services';
const GCP_SERVICE_IDS = {
    'Compute Engine': '6F81-5844-456A',
    'Cloud SQL': '9662-B51E-5089',
    'Cloud Storage': '95FF-2EF5-5EA1',
    'Cloud Run': '152E-C115-5142',
    'BigQuery': '24E6-581D-38E5',
};
function normalizeGcpRegion(region) {
    return region.toLowerCase().replace('_', '-');
}
let GcpPricingService = GcpPricingService_1 = class GcpPricingService {
    config;
    logger = new common_1.Logger(GcpPricingService_1.name);
    constructor(config) {
        this.config = config;
    }
    async getPrice(mapping, quantityHours) {
        const apiKey = this.config.get('GCP_API_KEY');
        if (!apiKey) {
            return { price: null, verified: false, reason: 'GCP_API_KEY não configurada' };
        }
        const serviceId = GCP_SERVICE_IDS[mapping.service];
        if (!serviceId) {
            return {
                price: null,
                verified: false,
                reason: `Serviço GCP "${mapping.service}" não mapeado para serviceId`,
            };
        }
        const region = mapping.region ? normalizeGcpRegion(mapping.region) : null;
        if (!region) {
            return { price: null, verified: false, reason: 'Região GCP não informada no mapeamento' };
        }
        try {
            const skuIdentifier = mapping.machineType ?? mapping.tier;
            const url = `${GCP_BILLING_API}/${serviceId}/skus?currencyCode=USD&key=${apiKey}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!response.ok) {
                return { price: null, verified: false, reason: `HTTP ${response.status} da GCP Billing API` };
            }
            const data = await response.json();
            const sku = this.findSku(data.skus, skuIdentifier, region);
            if (!sku) {
                return {
                    price: null,
                    verified: false,
                    reason: `SKU para ${skuIdentifier ?? mapping.service} não encontrado na região ${region}`,
                };
            }
            const hourlyPrice = this.extractHourlyPrice(sku);
            if (hourlyPrice === null) {
                return { price: null, verified: false, reason: 'Estrutura de preço inesperada na resposta GCP' };
            }
            return {
                price: hourlyPrice,
                unit: 'hora',
                estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
                source: 'GCP Cloud Billing API',
                verified: true,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro ao consultar GCP Billing API: ${msg}`);
            return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
        }
    }
    findSku(skus, identifier, region) {
        if (!identifier)
            return null;
        const normalized = identifier.toLowerCase();
        return (skus.find((s) => s.description.toLowerCase().includes(normalized) &&
            s.serviceRegions.some((r) => r.toLowerCase() === region)) ?? null);
    }
    extractHourlyPrice(sku) {
        const pricing = sku.pricingInfo?.[0]?.pricingExpression;
        if (!pricing)
            return null;
        const rate = pricing.tieredRates?.[0];
        if (!rate)
            return null;
        const price = parseInt(rate.unitPrice.units || '0') + rate.unitPrice.nanos / 1e9;
        return price > 0 ? Number(price.toFixed(6)) : null;
    }
};
exports.GcpPricingService = GcpPricingService;
exports.GcpPricingService = GcpPricingService = GcpPricingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GcpPricingService);
//# sourceMappingURL=gcp-pricing.service.js.map