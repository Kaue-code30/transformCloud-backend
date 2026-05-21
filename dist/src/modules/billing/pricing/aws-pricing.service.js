"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AwsPricingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwsPricingService = void 0;
const common_1 = require("@nestjs/common");
const AWS_PRICING_API = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws';
const AWS_REGION_NAMES = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-1': 'US West (N. California)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'Europe (Ireland)',
    'eu-central-1': 'Europe (Frankfurt)',
    'ap-southeast-1': 'Asia Pacific (Singapore)',
    'ap-northeast-1': 'Asia Pacific (Tokyo)',
    'sa-east-1': 'South America (Sao Paulo)',
};
let AwsPricingService = AwsPricingService_1 = class AwsPricingService {
    logger = new common_1.Logger(AwsPricingService_1.name);
    async getPrice(params, quantityHours) {
        if (!params.instanceType && params.service === 'AmazonEC2') {
            return { price: null, verified: false, reason: 'instanceType não informado' };
        }
        try {
            const regionName = AWS_REGION_NAMES[params.region];
            if (!regionName) {
                return { price: null, verified: false, reason: `Região ${params.region} não mapeada` };
            }
            const url = `${AWS_PRICING_API}/${params.service}/current/${params.region}/index.json`;
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) {
                return { price: null, verified: false, reason: `HTTP ${response.status} da AWS Pricing API` };
            }
            const data = await response.json();
            const productSku = this.findProductSku(data, params, regionName);
            if (!productSku) {
                return {
                    price: null,
                    verified: false,
                    reason: `Produto ${params.instanceType ?? params.service} não encontrado nos offers`,
                };
            }
            const onDemandTerms = data.terms?.OnDemand?.[productSku];
            if (!onDemandTerms) {
                return { price: null, verified: false, reason: 'Sem termos OnDemand para este SKU' };
            }
            const hourlyPrice = this.extractHourlyPrice(onDemandTerms);
            if (hourlyPrice === null) {
                return { price: null, verified: false, reason: 'Preço não encontrado nos termos OnDemand' };
            }
            return {
                price: hourlyPrice,
                unit: 'hora',
                estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
                source: 'AWS Pricing API',
                verified: true,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro ao consultar AWS Pricing: ${msg}`);
            return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
        }
    }
    findProductSku(data, params, regionName) {
        for (const [sku, product] of Object.entries(data.products)) {
            const attr = product.attributes;
            if (attr.location !== regionName)
                continue;
            if (params.service === 'AmazonEC2') {
                if (attr.instanceType === params.instanceType &&
                    attr.operatingSystem === (params.operatingSystem ?? 'Linux') &&
                    attr.tenancy === 'Shared') {
                    return sku;
                }
            }
            else if (params.service === 'AmazonRDS') {
                if (attr.instanceType === params.instanceType &&
                    (params.databaseEngine ? attr.servicecode?.toLowerCase().includes(params.databaseEngine.toLowerCase()) : true)) {
                    return sku;
                }
            }
            else {
                return sku;
            }
        }
        return null;
    }
    extractHourlyPrice(terms) {
        for (const term of Object.values(terms)) {
            for (const dim of Object.values(term.priceDimensions)) {
                const usd = parseFloat(dim.pricePerUnit.USD);
                if (!isNaN(usd) && usd > 0)
                    return usd;
            }
        }
        return null;
    }
};
exports.AwsPricingService = AwsPricingService;
exports.AwsPricingService = AwsPricingService = AwsPricingService_1 = __decorate([
    (0, common_1.Injectable)()
], AwsPricingService);
//# sourceMappingURL=aws-pricing.service.js.map