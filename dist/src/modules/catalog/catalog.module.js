"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../../prisma/prisma.module");
const catalog_repository_1 = require("./catalog.repository");
const catalog_import_service_1 = require("./catalog-import.service");
const catalog_pricing_service_1 = require("./catalog-pricing.service");
const aws_catalog_adapter_1 = require("./providers/aws/aws-catalog.adapter");
const gcp_catalog_adapter_1 = require("./providers/gcp/gcp-catalog.adapter");
let CatalogModule = class CatalogModule {
};
exports.CatalogModule = CatalogModule;
exports.CatalogModule = CatalogModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        providers: [catalog_repository_1.CatalogRepository, catalog_import_service_1.CatalogImportService, catalog_pricing_service_1.CatalogPricingService, aws_catalog_adapter_1.AwsCatalogAdapter, gcp_catalog_adapter_1.GcpCatalogAdapter],
        exports: [catalog_repository_1.CatalogRepository, catalog_import_service_1.CatalogImportService, catalog_pricing_service_1.CatalogPricingService, aws_catalog_adapter_1.AwsCatalogAdapter, gcp_catalog_adapter_1.GcpCatalogAdapter],
    })
], CatalogModule);
//# sourceMappingURL=catalog.module.js.map