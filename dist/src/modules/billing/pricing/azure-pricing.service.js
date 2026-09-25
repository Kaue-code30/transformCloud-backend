"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var AzurePricingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzurePricingService = void 0;
const https = __importStar(require("node:https"));
const common_1 = require("@nestjs/common");
const AZURE_PRICES_API = 'https://prices.azure.com/api/retail/prices';
const SERVICES_WITH_CONTAINS = new Set([
    'Azure Cache for Redis',
    'Azure Blob Storage',
    'Azure Database for PostgreSQL Flexible Server',
    'Azure Database for MySQL Flexible Server',
]);
function httpsGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout (${timeoutMs}ms)`)); });
        req.on('error', reject);
    });
}
let AzurePricingService = AzurePricingService_1 = class AzurePricingService {
    logger = new common_1.Logger(AzurePricingService_1.name);
    async getPrice(mapping, quantityHours) {
        const skuName = mapping.skuName ?? mapping.sku;
        if (!skuName || !mapping.region) {
            return { price: null, verified: false, reason: 'Parâmetros insuficientes no mapeamento' };
        }
        const attempts = buildQueryAttempts(skuName, mapping.region, mapping.service);
        for (const attempt of attempts) {
            const url = `${AZURE_PRICES_API}?$filter=${encodeURIComponent(attempt.filter)}`;
            this.logger.debug(`Azure query (${attempt.label}): ${url}`);
            try {
                const body = await httpsGet(url, 25000);
                const data = JSON.parse(body);
                if (!data.Items?.length)
                    continue;
                const candidates = data.Items.filter((i) => i.retailPrice > 0);
                if (!candidates.length)
                    continue;
                const item = candidates.reduce((min, cur) => cur.retailPrice < min.retailPrice ? cur : min);
                this.logger.debug(`Azure match (${attempt.label}): ${item.armSkuName} — $${item.retailPrice}/${item.unitOfMeasure}`);
                return {
                    price: item.retailPrice,
                    unit: item.unitOfMeasure,
                    estimatedMonthly: Number((item.retailPrice * quantityHours).toFixed(2)),
                    source: 'Azure Retail Prices API',
                    verified: true,
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Azure query falhou (${attempt.label}): ${msg}`);
            }
        }
        this.logger.warn(`Azure: nenhum resultado para SKU "${skuName}" na região "${mapping.region}"`);
        return {
            price: null,
            verified: false,
            reason: `SKU "${skuName}" não encontrado na região ${mapping.region}`,
        };
    }
};
exports.AzurePricingService = AzurePricingService;
exports.AzurePricingService = AzurePricingService = AzurePricingService_1 = __decorate([
    (0, common_1.Injectable)()
], AzurePricingService);
function buildQueryAttempts(skuName, region, service) {
    const skuBase = skuName.split(' ')[0];
    const useContains = service ? SERVICES_WITH_CONTAINS.has(service) : false;
    const skuFilter = useContains
        ? `contains(armSkuName,'${skuBase}')`
        : `armSkuName eq '${skuBase}'`;
    return [
        {
            label: 'exact+region',
            filter: [skuFilter, `armRegionName eq '${region}'`, `priceType eq 'Consumption'`].join(' and '),
        },
        ...(useContains ? [] : [{
                label: 'contains+region',
                filter: [`contains(armSkuName,'${skuBase}')`, `armRegionName eq '${region}'`, `priceType eq 'Consumption'`].join(' and '),
            }]),
        {
            label: 'contains+no-region',
            filter: [`contains(armSkuName,'${skuBase}')`, `priceType eq 'Consumption'`].join(' and '),
        },
    ];
}
//# sourceMappingURL=azure-pricing.service.js.map