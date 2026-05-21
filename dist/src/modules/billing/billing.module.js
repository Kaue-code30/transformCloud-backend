"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingModule = void 0;
const common_1 = require("@nestjs/common");
const azure_pricing_service_1 = require("./pricing/azure-pricing.service");
const aws_pricing_service_1 = require("./pricing/aws-pricing.service");
const gcp_pricing_service_1 = require("./pricing/gcp-pricing.service");
const pricing_orchestrator_service_1 = require("./pricing/pricing-orchestrator.service");
let BillingModule = class BillingModule {
};
exports.BillingModule = BillingModule;
exports.BillingModule = BillingModule = __decorate([
    (0, common_1.Module)({
        providers: [
            azure_pricing_service_1.AzurePricingService,
            aws_pricing_service_1.AwsPricingService,
            gcp_pricing_service_1.GcpPricingService,
            pricing_orchestrator_service_1.PricingOrchestratorService,
        ],
        exports: [pricing_orchestrator_service_1.PricingOrchestratorService],
    })
], BillingModule);
//# sourceMappingURL=billing.module.js.map