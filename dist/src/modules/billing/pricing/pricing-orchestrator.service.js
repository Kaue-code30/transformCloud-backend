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
exports.PricingOrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const azure_pricing_service_1 = require("./azure-pricing.service");
const aws_pricing_service_1 = require("./aws-pricing.service");
const gcp_pricing_service_1 = require("./gcp-pricing.service");
let PricingOrchestratorService = class PricingOrchestratorService {
    azure;
    aws;
    gcp;
    constructor(azure, aws, gcp) {
        this.azure = azure;
        this.aws = aws;
        this.gcp = gcp;
    }
    async fetchPrices(billing, mappings) {
        const results = await Promise.all(billing.topServices.map((svc) => {
            const mapping = mappings.mappings.find((m) => m.original.toLowerCase().includes(svc.name.toLowerCase()));
            return this.fetchServicePrice(svc, mapping ?? null);
        }));
        return this.classify(results, billing.totalCost);
    }
    async fetchServicePrice(svc, mapping) {
        const hours = this.estimateHours(svc);
        const [gcpEntry, azureEntry] = await Promise.all([
            mapping?.gcp
                ? this.gcp.getPrice(mapping.gcp, hours)
                : this.notAvailable('Sem mapeamento GCP'),
            mapping?.azure
                ? this.azure.getPrice(mapping.azure, hours)
                : this.notAvailable('Sem mapeamento Azure'),
        ]);
        const ociEntry = {
            price: null,
            verified: false,
            reason: 'API pública não disponível para OCI',
        };
        return {
            service: svc.name,
            currentCost: svc.cost,
            gcp: gcpEntry,
            azure: azureEntry,
            oci: ociEntry,
            gcpConfidence: mapping?.gcp?.confidence ?? null,
            azureConfidence: mapping?.azure?.confidence ?? null,
        };
    }
    classify(raw, totalCost) {
        const classified = raw.map((item) => ({
            service: item.service,
            currentCost: item.currentCost,
            gcp: item.gcp,
            azure: item.azure,
            oci: item.oci,
            gcpStatus: this.resolveStatus(item.gcp, item.gcpConfidence),
            azureStatus: this.resolveStatus(item.azure, item.azureConfidence),
            ociStatus: 'no_api',
        }));
        const verifiedCost = classified
            .filter((c) => c.gcpStatus === 'verified' || c.azureStatus === 'verified')
            .reduce((sum, c) => sum + c.currentCost, 0);
        const verifiedServices = classified.filter((c) => c.gcpStatus === 'verified' || c.azureStatus === 'verified').length;
        const partialServices = classified.filter((c) => (c.gcpStatus === 'partial' || c.azureStatus === 'partial') &&
            c.gcpStatus !== 'verified' &&
            c.azureStatus !== 'verified').length;
        const notFoundServices = classified.filter((c) => c.gcpStatus === 'not_found' &&
            c.azureStatus === 'not_found').length;
        return {
            classified,
            meta: {
                analyzedServices: classified.length,
                verifiedServices,
                partialServices,
                notFoundServices,
                coveredCostPct: totalCost > 0
                    ? Math.round((verifiedCost / totalCost) * 100)
                    : 0,
            },
        };
    }
    resolveStatus(entry, confidence) {
        if (!entry.verified || entry.price === null)
            return 'not_found';
        if (confidence === 'high')
            return 'verified';
        if (confidence === 'medium' || confidence === 'low')
            return 'partial';
        return 'verified';
    }
    notAvailable(reason) {
        return { price: null, verified: false, reason };
    }
    estimateHours(svc) {
        const match = svc.quantity.match(/(\d+)\s*hora/i);
        if (match)
            return parseInt(match[1]);
        return 730;
    }
};
exports.PricingOrchestratorService = PricingOrchestratorService;
exports.PricingOrchestratorService = PricingOrchestratorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [azure_pricing_service_1.AzurePricingService,
        aws_pricing_service_1.AwsPricingService,
        gcp_pricing_service_1.GcpPricingService])
], PricingOrchestratorService);
//# sourceMappingURL=pricing-orchestrator.service.js.map