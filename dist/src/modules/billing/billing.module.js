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
const catalog_module_1 = require("../catalog/catalog.module");
const pricing_orchestrator_service_1 = require("./pricing/pricing-orchestrator.service");
const claude_service_1 = require("./ai/claude.service");
const deterministic_mapping_service_1 = require("./mapping/deterministic-mapping.service");
const pipeline_service_1 = require("./pipeline.service");
const billing_controller_1 = require("./billing.controller");
let BillingModule = class BillingModule {
};
exports.BillingModule = BillingModule;
exports.BillingModule = BillingModule = __decorate([
    (0, common_1.Module)({
        imports: [catalog_module_1.CatalogModule],
        controllers: [billing_controller_1.BillingController],
        providers: [
            pricing_orchestrator_service_1.PricingOrchestratorService,
            deterministic_mapping_service_1.DeterministicMappingService,
            claude_service_1.ClaudeService,
            pipeline_service_1.PipelineService,
        ],
        exports: [pipeline_service_1.PipelineService],
    })
], BillingModule);
//# sourceMappingURL=billing.module.js.map