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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var GcpPricingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcpPricingService = void 0;
const https = __importStar(require("node:https"));
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const GCP_BILLING_API = 'https://cloudbilling.googleapis.com/v1/services';
const GCP_SERVICE_IDS = {
    'Compute Engine': '6F81-5844-456A',
    'Cloud SQL': '9662-B51E-5089',
    'Cloud Storage': '95FF-2EF5-5EA1',
    'Cloud Run': '152E-C115-5142',
    'BigQuery': '24E6-581D-38E5',
    'Memorystore': 'E2D0-0E09-0018',
    'AlloyDB': '9BAE-B4E0-5BF3',
    'Cloud Armor': '975A-27C5-B553',
};
const MACHINE_FAMILY_TERMS = {
    'n1': ['n1 predefined instance core', 'n1 instance core'],
    'n2': ['n2 instance core', 'n2 custom instance core'],
    'n2d': ['n2d amd instance core'],
    'n4': ['n4 instance core'],
    'c2': ['compute optimized core'],
    'c2d': ['c2d amd compute optimized core'],
    'c3': ['c3 instance core'],
    'c3a': ['c3a arm instance core'],
    'c4': ['c4 instance core'],
    'c4a': ['c4a arm instance core'],
    'e2': ['e2 instance core'],
    'm1': ['memory-optimized instance core'],
    'm2': ['memory-optimized upgrade instance core'],
    'm3': ['m3 instance core'],
    'a2': ['a2 instance core'],
    'a3': ['a3 instance core'],
    'g2': ['g2 instance core'],
    't2a': ['tau t2a instance core'],
    't2d': ['tau t2d amd instance core'],
    'db-custom': ['db custom core', 'sql zonal - db custom core'],
    'db-n1': ['db n1 standard', 'sql zonal - db n1'],
    'db-n2': ['db n2 standard', 'sql zonal - db n2'],
    'db-highmem': ['db highmem', 'sql zonal - db highmem'],
    'm1-ultra': ['memorystore for redis ultra'],
    'm1-standard': ['memorystore for redis standard'],
    'standard': ['standard storage'],
    'nearline': ['nearline storage'],
    'coldline': ['coldline storage'],
};
let GcpPricingService = GcpPricingService_1 = class GcpPricingService {
    config;
    logger = new common_1.Logger(GcpPricingService_1.name);
    constructor(config) {
        this.config = config;
    }
    async getPrice(mapping, quantityHours) {
        const apiKey = this.config.get('GCP_API_KEY');
        if (!apiKey || apiKey.includes('COLOQUE_SUA')) {
            return { price: null, verified: false, reason: 'GCP_API_KEY não configurada' };
        }
        const serviceId = resolveServiceId(mapping.service);
        if (!serviceId) {
            return { price: null, verified: false, reason: `Serviço GCP "${mapping.service}" não reconhecido` };
        }
        const region = mapping.region ? mapping.region.toLowerCase().replace(/_/g, '-') : null;
        if (!region) {
            return { price: null, verified: false, reason: 'Região GCP não informada' };
        }
        const searchTerms = extractSearchTerms(mapping);
        if (!searchTerms.length) {
            return { price: null, verified: false, reason: 'Não foi possível extrair termo de busca do mapeamento' };
        }
        try {
            const skus = await fetchAllSkus(serviceId, apiKey, this.logger);
            for (const term of searchTerms) {
                let sku = findSku(skus, term, region);
                if (!sku)
                    sku = findSku(skus, term, null);
                if (sku) {
                    const unitPrice = extractUnitPrice(sku);
                    if (unitPrice !== null) {
                        this.logger.debug(`GCP match: "${sku.description}" (termo: "${term}") — $${unitPrice}/h`);
                        return {
                            price: unitPrice,
                            unit: 'hora',
                            estimatedMonthly: Number((unitPrice * quantityHours).toFixed(2)),
                            source: 'GCP Cloud Billing API',
                            verified: true,
                        };
                    }
                }
            }
            this.logger.warn(`GCP: nenhum SKU encontrado para ${mapping.service} (termos: ${searchTerms.join(', ')}) em ${region}`);
            return {
                price: null,
                verified: false,
                reason: `Nenhum SKU encontrado para ${mapping.service} em ${region}`,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Erro GCP Billing API (${mapping.service}): ${msg}`);
            return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
        }
    }
};
exports.GcpPricingService = GcpPricingService;
exports.GcpPricingService = GcpPricingService = GcpPricingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GcpPricingService);
function resolveServiceId(rawName) {
    const lower = rawName.toLowerCase().trim();
    for (const [name, id] of Object.entries(GCP_SERVICE_IDS)) {
        if (lower === name.toLowerCase())
            return id;
        if (lower.startsWith(name.toLowerCase()))
            return id;
        if (lower.includes(name.toLowerCase()))
            return id;
    }
    return null;
}
function extractSearchTerms(mapping) {
    const raw = (mapping.machineType ?? mapping.tier ?? '').toLowerCase().trim();
    if (!raw)
        return [];
    for (const [family, terms] of Object.entries(MACHINE_FAMILY_TERMS)) {
        if (raw.startsWith(family) || raw === family) {
            return terms;
        }
    }
    const family = raw.split('-')[0];
    if (family) {
        return [
            `${family} instance core`,
            `${family} custom instance core`,
            `${family} instance`,
            family,
        ];
    }
    return [];
}
async function fetchAllSkus(serviceId, apiKey, logger) {
    const allSkus = [];
    let pageToken;
    let page = 0;
    const maxPages = 5;
    do {
        const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
        const url = `${GCP_BILLING_API}/${serviceId}/skus?currencyCode=USD&pageSize=5000${tokenParam}&key=${apiKey}`;
        const body = await httpsGet(url, 25000);
        const data = JSON.parse(body);
        if (!data.skus?.length)
            break;
        allSkus.push(...data.skus);
        pageToken = data.nextPageToken;
        page++;
        logger.debug(`GCP SKUs carregados: ${allSkus.length} (página ${page})`);
    } while (pageToken && page < maxPages);
    return allSkus;
}
function findSku(skus, searchTerm, region) {
    const term = searchTerm.toLowerCase();
    return (skus.find((s) => {
        const descMatch = s.description.toLowerCase().includes(term);
        if (!descMatch)
            return false;
        if (!region)
            return true;
        return s.serviceRegions.some((r) => r.toLowerCase() === region);
    }) ?? null);
}
function extractUnitPrice(sku) {
    const pricing = sku.pricingInfo?.[0]?.pricingExpression;
    if (!pricing)
        return null;
    const rate = pricing.tieredRates?.find((r) => {
        const units = parseInt(r.unitPrice.units || '0');
        return units > 0 || r.unitPrice.nanos > 0;
    }) ?? pricing.tieredRates?.[0];
    if (!rate)
        return null;
    const price = parseInt(rate.unitPrice.units || '0') + rate.unitPrice.nanos / 1e9;
    return price > 0 ? Number(price.toFixed(6)) : null;
}
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
//# sourceMappingURL=gcp-pricing.service.js.map