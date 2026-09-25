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
var CatalogImportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogImportService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const catalog_repository_1 = require("./catalog.repository");
let CatalogImportService = CatalogImportService_1 = class CatalogImportService {
    prisma;
    catalog;
    logger = new common_1.Logger(CatalogImportService_1.name);
    constructor(prisma, catalog) {
        this.prisma = prisma;
        this.catalog = catalog;
    }
    async importSnapshot(snapshot) {
        validateSnapshot(snapshot);
        const provider = this.catalog.provider(snapshot.provider);
        const run = await this.prisma.catalogSyncRun.create({
            data: {
                provider,
                source: snapshot.source,
                version: snapshot.version,
                status: client_1.CatalogSyncStatus.RUNNING,
            },
        });
        try {
            const importedItems = await this.prisma.$transaction(async (tx) => {
                if (snapshot.mode === 'FULL') {
                    await tx.providerOffering.updateMany({
                        where: { provider },
                        data: { active: false },
                    });
                }
                const services = new Map();
                for (const service of snapshot.services) {
                    const saved = await tx.providerService.upsert({
                        where: {
                            provider_nativeCode: { provider, nativeCode: service.nativeCode },
                        },
                        create: {
                            provider,
                            nativeCode: service.nativeCode,
                            name: service.name,
                            resourceKind: this.catalog.resourceKind(service.resourceKind),
                        },
                        update: {
                            name: service.name,
                            resourceKind: this.catalog.resourceKind(service.resourceKind),
                        },
                    });
                    services.set(service.nativeCode, saved.id);
                }
                const offerings = new Map();
                for (const offering of snapshot.offerings) {
                    const serviceId = requiredServiceId(services, offering.serviceNativeCode);
                    const saved = await tx.providerOffering.upsert({
                        where: { sourceKey: offering.sourceKey },
                        create: {
                            sourceKey: offering.sourceKey,
                            serviceId,
                            provider,
                            nativeProductId: offering.nativeProductId,
                            nativeSkuName: offering.nativeSkuName,
                            displayName: offering.displayName,
                            region: offering.region,
                            purchaseOption: offering.purchaseOption ?? 'ON_DEMAND',
                            operatingSystem: offering.operatingSystem,
                            architecture: offering.architecture,
                            family: offering.family,
                            generation: offering.generation,
                            engine: offering.engine,
                            vcpu: decimalOrUndefined(offering.vcpu),
                            memoryGiB: decimalOrUndefined(offering.memoryGiB),
                            highAvailability: offering.highAvailability,
                            attributes: json(offering.attributes ?? {}),
                            rawSource: json(offering.rawSource),
                            active: offering.active ?? true,
                            effectiveFrom: dateOrUndefined(offering.effectiveFrom),
                            effectiveTo: dateOrUndefined(offering.effectiveTo),
                        },
                        update: {
                            serviceId,
                            provider,
                            nativeProductId: offering.nativeProductId,
                            nativeSkuName: offering.nativeSkuName,
                            displayName: offering.displayName,
                            region: offering.region,
                            purchaseOption: offering.purchaseOption ?? 'ON_DEMAND',
                            operatingSystem: offering.operatingSystem,
                            architecture: offering.architecture,
                            family: offering.family,
                            generation: offering.generation,
                            engine: offering.engine,
                            vcpu: decimalOrUndefined(offering.vcpu),
                            memoryGiB: decimalOrUndefined(offering.memoryGiB),
                            highAvailability: offering.highAvailability,
                            attributes: json(offering.attributes ?? {}),
                            rawSource: json(offering.rawSource),
                            active: offering.active ?? true,
                            effectiveFrom: dateOrUndefined(offering.effectiveFrom),
                            effectiveTo: dateOrUndefined(offering.effectiveTo),
                        },
                    });
                    offerings.set(offering.sourceKey, saved.id);
                }
                const meters = new Map();
                for (const meter of snapshot.meters) {
                    const serviceId = requiredServiceId(services, meter.serviceNativeCode);
                    const saved = await tx.providerMeter.upsert({
                        where: { sourceKey: meter.sourceKey },
                        create: {
                            sourceKey: meter.sourceKey,
                            serviceId,
                            provider,
                            nativeSkuId: meter.nativeSkuId,
                            nativeMeterId: meter.nativeMeterId,
                            name: meter.name,
                            region: meter.region,
                            pricingUnit: meter.pricingUnit,
                            unitMultiplier: decimal(meter.unitMultiplier ?? 1),
                            currency: meter.currency ?? 'USD',
                            priceType: this.catalog.priceType(meter.priceType ?? 'ON_DEMAND'),
                            effectiveFrom: requiredDate(meter.effectiveFrom),
                            effectiveTo: dateOrUndefined(meter.effectiveTo),
                            attributes: json(meter.attributes ?? {}),
                            rawSource: json(meter.rawSource),
                        },
                        update: {
                            serviceId,
                            provider,
                            nativeSkuId: meter.nativeSkuId,
                            nativeMeterId: meter.nativeMeterId,
                            name: meter.name,
                            region: meter.region,
                            pricingUnit: meter.pricingUnit,
                            unitMultiplier: decimal(meter.unitMultiplier ?? 1),
                            currency: meter.currency ?? 'USD',
                            priceType: this.catalog.priceType(meter.priceType ?? 'ON_DEMAND'),
                            effectiveFrom: requiredDate(meter.effectiveFrom),
                            effectiveTo: dateOrUndefined(meter.effectiveTo),
                            attributes: json(meter.attributes ?? {}),
                            rawSource: json(meter.rawSource),
                        },
                    });
                    await tx.priceTier.deleteMany({ where: { meterId: saved.id } });
                    await tx.priceTier.createMany({
                        data: meter.tiers.map((tier) => ({
                            meterId: saved.id,
                            startQuantity: decimal(tier.startQuantity),
                            endQuantity: decimalOrUndefined(tier.endQuantity),
                            unitPrice: decimal(tier.unitPrice),
                        })),
                    });
                    meters.set(meter.sourceKey, saved.id);
                }
                const importedOfferingIds = [...offerings.values()];
                if (importedOfferingIds.length) {
                    await tx.offeringMeter.deleteMany({
                        where: { offeringId: { in: importedOfferingIds } },
                    });
                }
                for (const link of snapshot.offeringMeters) {
                    const offeringId = offerings.get(link.offeringSourceKey);
                    const meterId = meters.get(link.meterSourceKey);
                    if (!offeringId || !meterId) {
                        throw new common_1.BadRequestException(`Vínculo inválido: ${link.offeringSourceKey} -> ${link.meterSourceKey}`);
                    }
                    await tx.offeringMeter.upsert({
                        where: { offeringId_meterId: { offeringId, meterId } },
                        create: {
                            offeringId,
                            meterId,
                            quantity: decimal(link.quantity ?? 1),
                        },
                        update: { quantity: decimal(link.quantity ?? 1) },
                    });
                }
                return (snapshot.services.length +
                    snapshot.offerings.length +
                    snapshot.meters.length +
                    snapshot.offeringMeters.length);
            });
            await this.prisma.catalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: client_1.CatalogSyncStatus.COMPLETED,
                    importedItems,
                    finishedAt: new Date(),
                },
            });
            this.logger.log(`Catálogo ${snapshot.provider}/${snapshot.version ?? 'sem versão'} importado: ${importedItems} itens`);
            return { runId: run.id, importedItems };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.prisma.catalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: client_1.CatalogSyncStatus.FAILED,
                    errorMessage: message,
                    finishedAt: new Date(),
                },
            });
            throw error;
        }
    }
};
exports.CatalogImportService = CatalogImportService;
exports.CatalogImportService = CatalogImportService = CatalogImportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        catalog_repository_1.CatalogRepository])
], CatalogImportService);
function validateSnapshot(snapshot) {
    if (!snapshot?.provider || !snapshot.source) {
        throw new common_1.BadRequestException('provider e source são obrigatórios no snapshot');
    }
    if (!PROVIDERS.has(snapshot.provider)) {
        throw new common_1.BadRequestException(`provider inválido: ${snapshot.provider}`);
    }
    if (snapshot.mode && snapshot.mode !== 'FULL' && snapshot.mode !== 'PARTIAL') {
        throw new common_1.BadRequestException(`mode inválido: ${snapshot.mode}`);
    }
    if (!Array.isArray(snapshot.services) ||
        !Array.isArray(snapshot.offerings) ||
        !Array.isArray(snapshot.meters) ||
        !Array.isArray(snapshot.offeringMeters)) {
        throw new common_1.BadRequestException('services, offerings, meters e offeringMeters devem ser arrays');
    }
    assertUnique(snapshot.offerings.map((item) => item.sourceKey), 'offering.sourceKey');
    assertUnique(snapshot.meters.map((item) => item.sourceKey), 'meter.sourceKey');
    for (const service of snapshot.services) {
        if (!service.nativeCode || !service.name || !RESOURCE_KINDS.has(service.resourceKind)) {
            throw new common_1.BadRequestException(`Serviço inválido: ${service.nativeCode || '<sem código>'}`);
        }
    }
    for (const offering of snapshot.offerings) {
        if (!offering.sourceKey ||
            !offering.serviceNativeCode ||
            !offering.nativeSkuName ||
            !offering.region ||
            !isObject(offering.rawSource)) {
            throw new common_1.BadRequestException(`Oferta inválida: ${offering.sourceKey || '<sem chave>'}`);
        }
        if (offering.vcpu != null && offering.vcpu <= 0) {
            throw new common_1.BadRequestException(`vcpu inválida em ${offering.sourceKey}`);
        }
        if (offering.memoryGiB != null && offering.memoryGiB <= 0) {
            throw new common_1.BadRequestException(`memoryGiB inválida em ${offering.sourceKey}`);
        }
    }
    for (const meter of snapshot.meters) {
        if (!meter.sourceKey ||
            !meter.serviceNativeCode ||
            !meter.nativeSkuId ||
            !meter.pricingUnit ||
            !meter.region ||
            !isObject(meter.rawSource) ||
            (meter.priceType != null && !PRICE_TYPES.has(meter.priceType)) ||
            (meter.unitMultiplier != null && meter.unitMultiplier <= 0)) {
            throw new common_1.BadRequestException(`Medidor inválido: ${meter.sourceKey || '<sem chave>'}`);
        }
        requiredDate(meter.effectiveFrom);
        if (!meter.tiers?.length) {
            throw new common_1.BadRequestException(`Medidor ${meter.sourceKey} não possui tiers`);
        }
        for (const tier of meter.tiers) {
            if (tier.startQuantity < 0 ||
                tier.unitPrice < 0 ||
                (tier.endQuantity != null && tier.endQuantity <= tier.startQuantity)) {
                throw new common_1.BadRequestException(`Tier inválido em ${meter.sourceKey}`);
            }
        }
    }
    for (const link of snapshot.offeringMeters) {
        if (!link.offeringSourceKey || !link.meterSourceKey || (link.quantity ?? 1) <= 0) {
            throw new common_1.BadRequestException('Vínculo offeringMeter inválido');
        }
    }
}
const PROVIDERS = new Set(['AWS', 'GCP', 'AZURE', 'OCI']);
const RESOURCE_KINDS = new Set([
    'COMPUTE_VM',
    'MANAGED_POSTGRES',
    'MANAGED_MYSQL',
    'OBJECT_STORAGE',
    'BLOCK_STORAGE',
    'REDIS_CACHE',
    'KUBERNETES',
    'LOAD_BALANCER',
    'WAF',
    'DATA_TRANSFER',
    'SERVERLESS_FUNCTION',
    'OBSERVABILITY_LOGS',
]);
const PRICE_TYPES = new Set(['ON_DEMAND', 'RESERVED', 'SPOT', 'SAVINGS_PLAN', 'OTHER']);
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertUnique(values, field) {
    if (new Set(values).size !== values.length) {
        throw new common_1.BadRequestException(`${field} duplicado no snapshot`);
    }
}
function requiredServiceId(services, nativeCode) {
    const id = services.get(nativeCode);
    if (!id)
        throw new common_1.BadRequestException(`Serviço não encontrado no snapshot: ${nativeCode}`);
    return id;
}
function json(value) {
    return value;
}
function decimal(value) {
    if (!Number.isFinite(value))
        throw new common_1.BadRequestException(`Número inválido: ${value}`);
    return new client_1.Prisma.Decimal(value);
}
function decimalOrUndefined(value) {
    return value == null ? undefined : decimal(value);
}
function requiredDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        throw new common_1.BadRequestException(`Data inválida: ${value}`);
    return date;
}
function dateOrUndefined(value) {
    return value ? requiredDate(value) : undefined;
}
//# sourceMappingURL=catalog-import.service.js.map