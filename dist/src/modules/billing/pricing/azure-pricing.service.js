"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AzurePricingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzurePricingService = void 0;
const common_1 = require("@nestjs/common");
const AZURE_PRICES_API = 'https://prices.azure.com/api/retail/prices';
let AzurePricingService = AzurePricingService_1 = class AzurePricingService {
    logger = new common_1.Logger(AzurePricingService_1.name);
    async getPrice(mapping, quantityHours) {
        const skuName = mapping.skuName ?? mapping.sku;
        if (!skuName || !mapping.region) {
            return {
                price: null,
                verified: false,
                reason: 'Parâmetros insuficientes no mapeamento',
            };
        }
        try {
            const filter = [
                `serviceName eq '${mapping.service}'`,
                `armSkuName eq '${skuName}'`,
                `armRegionName eq '${mapping.region}'`,
                `priceType eq 'Consumption'`,
            ].join(' and ');
            const url = `${AZURE_PRICES_API}?$filter=${encodeURIComponent(filter)}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) {
                this.logger.warn(`Azure API retornou ${response.status} para SKU ${skuName}`);
                return { price: null, verified: false, reason: `HTTP ${response.status}` };
            }
            const data = await response.json();
            const item = data.Items?.[0];
            if (!item) {
                return {
                    price: null,
                    verified: false,
                    reason: `SKU ${skuName} não encontrado na região ${mapping.region}`,
                };
            }
            const estimatedMonthly = Number((item.retailPrice * quantityHours).toFixed(2));
            return {
                price: item.retailPrice,
                unit: item.unitOfMeasure,
                estimatedMonthly,
                source: 'Azure Retail Prices API',
                verified: true,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro ao consultar Azure Pricing: ${msg}`);
            return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
        }
    }
};
exports.AzurePricingService = AzurePricingService;
exports.AzurePricingService = AzurePricingService = AzurePricingService_1 = __decorate([
    (0, common_1.Injectable)()
], AzurePricingService);
//# sourceMappingURL=azure-pricing.service.js.map