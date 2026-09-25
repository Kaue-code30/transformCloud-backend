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
exports.CatalogRepository = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const offeringInclude = {
    service: true,
    meters: {
        include: {
            meter: {
                include: { tiers: { orderBy: { startQuantity: 'asc' } } },
            },
        },
    },
};
let CatalogRepository = class CatalogRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findOfferingByNativeIdentity(params) {
        if (!params.nativeSkuName && !params.nativeProductId)
            return null;
        const offering = await this.prisma.providerOffering.findFirst({
            where: {
                provider: params.provider,
                active: true,
                ...(params.region ? { region: params.region } : {}),
                OR: [
                    ...(params.nativeSkuName
                        ? [{ nativeSkuName: { equals: params.nativeSkuName, mode: 'insensitive' } }]
                        : []),
                    ...(params.nativeProductId
                        ? [{ nativeProductId: params.nativeProductId }]
                        : []),
                ],
            },
            include: { service: true },
        });
        return offering ? toOfferingView(offering) : null;
    }
    async findOfferingByMeterIdentity(params) {
        if (!params.skuId && !params.meterId)
            return null;
        const offering = await this.prisma.providerOffering.findFirst({
            where: {
                provider: params.provider,
                active: true,
                ...(params.region ? { region: params.region } : {}),
                ...(params.nativeSkuName
                    ? { nativeSkuName: { equals: params.nativeSkuName, mode: 'insensitive' } }
                    : {}),
                meters: {
                    some: {
                        meter: {
                            OR: [
                                ...(params.skuId ? [{ nativeSkuId: params.skuId }] : []),
                                ...(params.meterId ? [{ nativeMeterId: params.meterId }] : []),
                            ],
                        },
                    },
                },
            },
            include: { service: true },
        });
        return offering ? toOfferingView(offering) : null;
    }
    async findComputeCandidates(params) {
        const offerings = await this.prisma.providerOffering.findMany({
            where: {
                provider: params.provider,
                active: true,
                purchaseOption: 'ON_DEMAND',
                service: { resourceKind: client_1.ResourceKind.COMPUTE_VM },
                vcpu: { gte: new client_1.Prisma.Decimal(params.minimumVcpu) },
                memoryGiB: { gte: new client_1.Prisma.Decimal(params.minimumMemoryGiB) },
                ...(params.region ? { region: params.region } : {}),
                ...(params.operatingSystem
                    ? { operatingSystem: { equals: params.operatingSystem, mode: 'insensitive' } }
                    : {}),
                ...(params.architecture
                    ? { architecture: { equals: params.architecture, mode: 'insensitive' } }
                    : {}),
            },
            include: { service: true },
            take: 500,
        });
        return offerings.map(toOfferingView);
    }
    async findResourceCandidates(params) {
        const offerings = await this.prisma.providerOffering.findMany({
            where: {
                provider: params.provider,
                active: true,
                purchaseOption: 'ON_DEMAND',
                region: params.region,
                service: { resourceKind: params.resourceKind },
                ...(params.pricingUnits?.length
                    ? { meters: { some: { meter: { pricingUnit: { in: params.pricingUnits } } } } }
                    : {}),
                ...(params.engine
                    ? { engine: { equals: params.engine, mode: 'insensitive' } }
                    : {}),
                ...(params.minimumVcpu
                    ? { vcpu: { gte: new client_1.Prisma.Decimal(params.minimumVcpu) } }
                    : {}),
                ...(params.minimumMemoryGiB
                    ? { memoryGiB: { gte: new client_1.Prisma.Decimal(params.minimumMemoryGiB) } }
                    : {}),
            },
            include: { service: true },
            take: 500,
        });
        return offerings.map(toOfferingView);
    }
    async findApprovedOverride(sourceOfferingId, targetProvider) {
        const override = await this.prisma.mappingOverride.findFirst({
            where: {
                sourceOfferingId,
                targetProvider: targetProvider,
                status: client_1.MappingOverrideStatus.APPROVED,
            },
            include: {
                targetOffering: { include: { service: true } },
            },
        });
        return override ? toOfferingView(override.targetOffering) : null;
    }
    getOfferingWithPrices(id) {
        return this.prisma.providerOffering.findUnique({
            where: { id },
            include: offeringInclude,
        });
    }
    provider(value) {
        return value;
    }
    resourceKind(value) {
        return value;
    }
    priceType(value) {
        return value;
    }
};
exports.CatalogRepository = CatalogRepository;
exports.CatalogRepository = CatalogRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CatalogRepository);
function toOfferingView(offering) {
    return {
        id: offering.id,
        provider: offering.provider,
        resourceKind: offering.service.resourceKind,
        serviceName: offering.service.name,
        serviceNativeCode: offering.service.nativeCode,
        nativeProductId: offering.nativeProductId,
        nativeSkuName: offering.nativeSkuName,
        displayName: offering.displayName,
        region: offering.region,
        purchaseOption: offering.purchaseOption,
        operatingSystem: offering.operatingSystem,
        architecture: offering.architecture,
        family: offering.family,
        generation: offering.generation,
        engine: offering.engine,
        vcpu: offering.vcpu?.toNumber() ?? null,
        memoryGiB: offering.memoryGiB?.toNumber() ?? null,
        highAvailability: offering.highAvailability,
    };
}
//# sourceMappingURL=catalog.repository.js.map