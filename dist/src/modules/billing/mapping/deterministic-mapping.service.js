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
exports.DeterministicMappingService = void 0;
const common_1 = require("@nestjs/common");
const catalog_repository_1 = require("../../catalog/catalog.repository");
const TARGET_PROVIDERS = ['AWS', 'GCP', 'AZURE', 'OCI'];
let DeterministicMappingService = class DeterministicMappingService {
    catalog;
    constructor(catalog) {
        this.catalog = catalog;
    }
    async mapServices(billing) {
        const mappings = [];
        const unmapped = [];
        for (const service of billing.topServices) {
            const lineItem = findLineItem(service, billing.lineItems ?? []);
            const source = await this.resolveSource(billing.provider, service, lineItem);
            if (!source) {
                mappings.push({ original: service.name });
                unmapped.push({
                    service: service.name,
                    reason: 'Serviço sem estratégia determinística compatível ou SKU/capacidade não encontrada no catálogo',
                });
                continue;
            }
            const mapping = { original: service.name };
            const failures = [];
            for (const targetProvider of TARGET_PROVIDERS.filter((provider) => provider !== billing.provider)) {
                const targetRegion = resolveTargetRegion(billing.targetRegion ?? source.region, targetProvider);
                if (!targetRegion) {
                    failures.push(`${targetProvider}: região equivalente não cadastrada`);
                    continue;
                }
                const match = await this.findTarget(source, targetProvider, targetRegion);
                if (!match) {
                    failures.push(`${targetProvider}: nenhuma oferta compatível no catálogo`);
                    continue;
                }
                assignProviderMapping(mapping, match.offering, match.metadata);
            }
            mappings.push(mapping);
            if (!mapping.aws && !mapping.gcp && !mapping.azure && !mapping.oci) {
                unmapped.push({
                    service: service.name,
                    reason: failures.join('; ') || 'Nenhuma oferta compatível encontrada',
                });
            }
        }
        return { mappings, unmapped };
    }
    async resolveSource(provider, service, lineItem) {
        const nativeSkuName = service.nativeSkuName ??
            lineItem?.nativeSkuName ??
            extractSkuFromSpecs(provider, service.specs);
        const nativeProductId = service.nativeProductId ?? lineItem?.nativeProductId;
        const region = service.region ??
            lineItem?.region ??
            extractRegionFromSpecs(provider, service.specs);
        const offering = await this.findSourceOffering(provider, nativeSkuName, nativeProductId, region, lineItem?.skuId, lineItem?.meterId);
        if (offering) {
            if (offering.resourceKind === 'COMPUTE_VM' &&
                (!offering.vcpu || !offering.memoryGiB)) {
                return null;
            }
            return {
                offeringId: offering.id,
                resourceKind: offering.resourceKind,
                nativeSkuName: offering.nativeSkuName,
                region: offering.region,
                operatingSystem: offering.operatingSystem,
                architecture: offering.architecture,
                engine: offering.engine,
                usageUnit: lineItem?.unit ?? service.usageUnit ?? null,
                vcpu: offering.vcpu,
                memoryGiB: offering.memoryGiB,
            };
        }
        if (!isComputeService(provider, service, lineItem))
            return null;
        const vcpu = service.vcpu ?? numericAttribute(lineItem, ['vcpu', 'vcpus', 'cores']);
        const memoryGiB = service.memoryGiB ?? numericAttribute(lineItem, ['memoryGiB', 'memory_gib', 'memory']);
        if (!nativeSkuName || !region || !vcpu || !memoryGiB)
            return null;
        return {
            resourceKind: 'COMPUTE_VM',
            nativeSkuName,
            region,
            operatingSystem: normalizeOperatingSystem(service.operatingSystem ??
                stringAttribute(lineItem, ['operatingSystem', 'operating_system', 'os']) ??
                service.specs),
            architecture: normalizeArchitecture(service.architecture ??
                stringAttribute(lineItem, ['architecture', 'processorArchitecture']) ??
                service.specs),
            engine: null,
            usageUnit: lineItem?.unit ?? service.usageUnit ?? null,
            vcpu,
            memoryGiB,
        };
    }
    async findSourceOffering(provider, nativeSkuName, nativeProductId, region, skuId, meterId) {
        const byMeter = await this.catalog.findOfferingByMeterIdentity({
            provider,
            skuId,
            meterId,
            nativeSkuName,
            region,
        });
        if (byMeter)
            return byMeter;
        if (!nativeSkuName && !nativeProductId)
            return null;
        const exact = await this.catalog.findOfferingByNativeIdentity({
            provider,
            nativeSkuName,
            nativeProductId,
            region,
        });
        if (exact || !region)
            return exact;
        return this.catalog.findOfferingByNativeIdentity({
            provider,
            nativeSkuName,
            nativeProductId,
        });
    }
    async findTarget(source, targetProvider, targetRegion) {
        if (source.offeringId) {
            const override = await this.catalog.findApprovedOverride(source.offeringId, targetProvider);
            if (override?.region === targetRegion) {
                return {
                    offering: override,
                    metadata: {
                        catalogOfferingId: override.id,
                        matchType: 'manual_override',
                        score: 0,
                        evidence: [
                            'Equivalência aprovada manualmente',
                            `Região de destino: ${override.region}`,
                        ],
                    },
                };
            }
        }
        const candidates = source.resourceKind === 'COMPUTE_VM'
            ? await this.catalog.findComputeCandidates({
                provider: targetProvider,
                region: targetRegion,
                operatingSystem: source.operatingSystem,
                architecture: source.architecture,
                minimumVcpu: source.vcpu,
                minimumMemoryGiB: source.memoryGiB,
            })
            : await this.catalog.findResourceCandidates({
                provider: targetProvider,
                resourceKind: source.resourceKind,
                region: targetRegion,
                engine: source.engine,
                minimumVcpu: source.vcpu,
                minimumMemoryGiB: source.memoryGiB,
                pricingUnits: compatiblePricingUnits(source.usageUnit),
            });
        if (!candidates.length)
            return null;
        const ranked = candidates
            .map((offering) => {
            const score = scoreResource(source, offering);
            return { offering, score, rankScore: score + lifecyclePenalty(offering) };
        })
            .sort((a, b) => a.rankScore - b.rankScore || a.offering.nativeSkuName.localeCompare(b.offering.nativeSkuName));
        if (source.resourceKind !== 'COMPUTE_VM' &&
            source.vcpu == null &&
            source.memoryGiB == null &&
            ranked[1]?.rankScore === ranked[0].rankScore)
            return null;
        const selected = ranked[0];
        const exactCapacity = source.vcpu != null &&
            source.memoryGiB != null &&
            selected.offering.vcpu === source.vcpu &&
            selected.offering.memoryGiB === source.memoryGiB;
        const matchType = exactCapacity
            ? 'exact_capacity'
            : source.vcpu != null && source.memoryGiB != null
                ? 'capacity_match'
                : 'resource_kind_match';
        return {
            offering: selected.offering,
            metadata: {
                catalogOfferingId: selected.offering.id,
                matchType,
                score: Number(selected.score.toFixed(4)),
                evidence: buildEvidence(source, selected.offering, exactCapacity),
            },
        };
    }
};
exports.DeterministicMappingService = DeterministicMappingService;
exports.DeterministicMappingService = DeterministicMappingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [catalog_repository_1.CatalogRepository])
], DeterministicMappingService);
function assignProviderMapping(mapping, offering, metadata) {
    const confidence = confidenceFromScore(metadata.score, metadata.matchType);
    if (offering.provider === 'AWS') {
        mapping.aws = {
            ...metadata,
            service: offering.serviceNativeCode,
            instanceType: offering.nativeSkuName,
            region: offering.region,
            operatingSystem: offering.operatingSystem ?? undefined,
            databaseEngine: offering.engine ?? undefined,
            confidence,
        };
    }
    else if (offering.provider === 'GCP') {
        mapping.gcp = {
            ...metadata,
            service: offering.serviceName,
            machineType: offering.nativeSkuName,
            region: offering.region,
            confidence,
        };
    }
    else if (offering.provider === 'AZURE') {
        mapping.azure = {
            ...metadata,
            service: offering.serviceName,
            skuName: offering.nativeSkuName,
            sku: offering.nativeSkuName,
            region: offering.region,
            confidence,
        };
    }
    else {
        mapping.oci = {
            ...metadata,
            service: offering.serviceName,
            shape: offering.nativeSkuName,
            memoryGb: offering.memoryGiB ?? undefined,
            confidence,
        };
    }
}
function scoreResource(source, target) {
    if (source.vcpu == null || source.memoryGiB == null)
        return 0;
    const cpuDelta = Math.abs((target.vcpu ?? source.vcpu) - source.vcpu) / source.vcpu;
    const memoryDelta = Math.abs((target.memoryGiB ?? source.memoryGiB) - source.memoryGiB) / source.memoryGiB;
    const architecturePenalty = source.architecture == null
        ? 0.5
        : target.architecture !== source.architecture
            ? 1
            : 0;
    const osPenalty = source.operatingSystem == null
        ? 0.5
        : target.operatingSystem !== source.operatingSystem
            ? 1
            : 0;
    return cpuDelta * 0.4 + memoryDelta * 0.4 + architecturePenalty * 0.1 + osPenalty * 0.1;
}
function lifecyclePenalty(offering) {
    const name = offering.nativeSkuName.toLowerCase();
    const displayName = offering.displayName.toLowerCase();
    return (name.includes('min-instance') ? 10 : 0) +
        (name.includes('1st gen') ? 5 : 0) +
        (displayName.includes('fixture') ? 50 : 0) +
        (name.includes('deprecated') ? 100 : 0);
}
function compatiblePricingUnits(unit) {
    const normalized = (unit ?? '').toLowerCase().replace(/[\s_-]/g, '');
    if (/^(hrs?|hours?|horas?)$/.test(normalized))
        return ['Hrs', 'hour', 'Hour', 'h'];
    if (['gbsecond', 'gibsecond', 'gibys', 'gbs'].includes(normalized))
        return ['GB-Second', 'GB-s', 'GiB-s', 'GiBy.s'];
    if (['gbmo', 'gbmonth', 'gibymo'].includes(normalized))
        return ['GB-Mo', 'GB-month', 'GiBy.mo'];
    if (['gb', 'gib', 'giby'].includes(normalized))
        return ['GB', 'GiB', 'GiBy'];
    return unit ? [unit] : undefined;
}
function buildEvidence(source, target, exactCapacity) {
    if (source.vcpu == null || source.memoryGiB == null) {
        return [
            `Tipo de recurso compatível: ${source.resourceKind}`,
            `Região de destino: ${target.region}`,
            `Oferta verificada no catálogo: ${target.nativeSkuName}`,
        ];
    }
    return [
        exactCapacity
            ? `Capacidade exata: ${source.vcpu} vCPU e ${source.memoryGiB} GiB`
            : `Capacidade compatível: ${target.vcpu} vCPU e ${target.memoryGiB} GiB`,
        source.architecture
            ? `Arquitetura compatível: ${target.architecture}`
            : 'Arquitetura de origem não informada',
        source.operatingSystem
            ? `Sistema operacional compatível: ${target.operatingSystem}`
            : 'Sistema operacional de origem não informado',
        `Região de destino: ${target.region}`,
        `Oferta verificada no catálogo: ${target.nativeSkuName}`,
    ];
}
function confidenceFromScore(score, matchType) {
    if (matchType === 'manual_override' || score <= 0.05)
        return 'high';
    if (score <= 0.25)
        return 'medium';
    return 'low';
}
function findLineItem(service, lineItems) {
    if (service.sourceLineItemKey) {
        const exact = lineItems.find((item) => item.sourceKey === service.sourceLineItemKey);
        if (exact)
            return exact;
    }
    const serviceName = compact(service.name);
    return lineItems.find((item) => {
        const candidates = [item.serviceName, item.serviceCode].filter(Boolean).map(compact);
        return candidates.some((candidate) => candidate.includes(serviceName) || serviceName.includes(candidate));
    });
}
function numericAttribute(item, keys) {
    for (const key of keys) {
        const value = item?.attributes?.[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string') {
            const parsed = Number(value.replace(',', '.'));
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return undefined;
}
function stringAttribute(item, keys) {
    for (const key of keys) {
        const value = item?.attributes?.[key];
        if (typeof value === 'string' && value.trim())
            return value;
    }
    return undefined;
}
function extractSkuFromSpecs(provider, specs) {
    if (provider === 'AZURE')
        return specs.match(/Standard_[A-Za-z0-9_]+/i)?.[0];
    if (provider === 'AWS')
        return specs.match(/(?:db\.)?[a-z][a-z0-9]*\.[a-z0-9]+/i)?.[0];
    if (provider === 'GCP')
        return specs.match(/[a-z][a-z0-9]*-(?:standard|highmem|highcpu|micro|small|medium)-\d+/i)?.[0];
    return specs.match(/VM\.[A-Za-z0-9.]+(?:\.Flex)?/i)?.[0];
}
function extractRegionFromSpecs(provider, specs) {
    if (provider === 'AWS')
        return specs.match(/[a-z]{2}(?:-gov)?-[a-z]+-\d/i)?.[0];
    if (provider === 'GCP')
        return specs.match(/[a-z]+-[a-z]+\d/i)?.[0];
    const lower = specs.toLowerCase();
    return ALL_REGION_ALIASES.find((region) => lower.includes(region));
}
function normalizeOperatingSystem(value) {
    const lower = value?.toLowerCase() ?? '';
    if (lower.includes('windows'))
        return 'Windows';
    if (lower.includes('linux') || lower.includes('ubuntu') || lower.includes('rhel'))
        return 'Linux';
    return null;
}
function normalizeArchitecture(value) {
    const lower = value?.toLowerCase() ?? '';
    if (lower.includes('arm64') || lower.includes('aarch64') || lower.includes('graviton'))
        return 'arm64';
    if (lower.includes('x86_64') || lower.includes('amd64') || lower.includes('x86'))
        return 'x86_64';
    return null;
}
function compact(value) {
    return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function isComputeService(provider, service, lineItem) {
    const identities = [
        service.name,
        lineItem?.serviceCode,
        lineItem?.serviceName,
    ].map(compact);
    const markers = {
        AWS: ['amazonec2'],
        GCP: ['computeengine', 'computegoogleapiscom'],
        AZURE: ['microsoftcomputevirtualmachines', 'virtualmachines'],
        OCI: ['oraclecloudcompute', 'computeshape', 'coreservices'],
    };
    return identities.some((identity) => markers[provider].some((marker) => identity.includes(marker)));
}
const REGION_GROUPS = [
    {
        aliases: ['brasil', 'brazil', 'são paulo', 'sao paulo', 'sa-east-1', 'southamerica-east1', 'brazilsouth', 'sa-saopaulo-1'],
        AWS: 'sa-east-1',
        GCP: 'southamerica-east1',
        AZURE: 'brazilsouth',
        OCI: 'sa-saopaulo-1',
    },
    {
        aliases: ['us east', 'n. virginia', 'virginia', 'us-east-1', 'us-east4', 'eastus', 'us-ashburn-1'],
        AWS: 'us-east-1',
        GCP: 'us-east4',
        AZURE: 'eastus',
        OCI: 'us-ashburn-1',
    },
    {
        aliases: ['ohio', 'us-east-2', 'us-east1', 'eastus2'],
        AWS: 'us-east-2',
        GCP: 'us-east1',
        AZURE: 'eastus2',
        OCI: 'us-ashburn-1',
    },
    {
        aliases: ['oregon', 'us-west-2', 'us-west1', 'westus2', 'us-phoenix-1'],
        AWS: 'us-west-2',
        GCP: 'us-west1',
        AZURE: 'westus2',
        OCI: 'us-phoenix-1',
    },
    {
        aliases: ['europa', 'europe', 'ireland', 'irlanda', 'eu-west-1', 'europe-west1', 'westeurope', 'uk-london-1'],
        AWS: 'eu-west-1',
        GCP: 'europe-west1',
        AZURE: 'westeurope',
        OCI: 'uk-london-1',
    },
    {
        aliases: ['frankfurt', 'eu-central-1', 'europe-west3', 'germanywestcentral', 'eu-frankfurt-1'],
        AWS: 'eu-central-1',
        GCP: 'europe-west3',
        AZURE: 'germanywestcentral',
        OCI: 'eu-frankfurt-1',
    },
    {
        aliases: ['singapore', 'singapura', 'ap-southeast-1', 'asia-southeast1', 'southeastasia', 'ap-singapore-1'],
        AWS: 'ap-southeast-1',
        GCP: 'asia-southeast1',
        AZURE: 'southeastasia',
        OCI: 'ap-singapore-1',
    },
    {
        aliases: ['tokyo', 'tóquio', 'toquio', 'ap-northeast-1', 'asia-northeast1', 'japaneast', 'ap-tokyo-1'],
        AWS: 'ap-northeast-1',
        GCP: 'asia-northeast1',
        AZURE: 'japaneast',
        OCI: 'ap-tokyo-1',
    },
];
const ALL_REGION_ALIASES = REGION_GROUPS.flatMap((group) => group.aliases);
function resolveTargetRegion(requestedRegion, provider) {
    const normalized = requestedRegion.toLowerCase().trim();
    const withoutZone = normalized.replace(/([a-z]{2}(?:-gov)?-[a-z]+-\d)[a-z]$/, '$1');
    const group = REGION_GROUPS.find(({ aliases, AWS, GCP, AZURE, OCI }) => [...aliases, AWS, GCP, AZURE, OCI].some((value) => value.toLowerCase() === withoutZone));
    return group?.[provider] ?? null;
}
//# sourceMappingURL=deterministic-mapping.service.js.map