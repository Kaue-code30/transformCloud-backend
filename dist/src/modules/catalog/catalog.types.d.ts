export type CatalogProvider = 'AWS' | 'GCP' | 'AZURE' | 'OCI';
export type CatalogResourceKind = 'COMPUTE_VM' | 'MANAGED_POSTGRES' | 'MANAGED_MYSQL' | 'OBJECT_STORAGE' | 'BLOCK_STORAGE' | 'REDIS_CACHE' | 'KUBERNETES' | 'LOAD_BALANCER' | 'WAF' | 'DATA_TRANSFER' | 'SERVERLESS_FUNCTION' | 'OBSERVABILITY_LOGS';
export type CatalogPriceType = 'ON_DEMAND' | 'RESERVED' | 'SPOT' | 'SAVINGS_PLAN' | 'OTHER';
export interface CatalogServiceInput {
    nativeCode: string;
    name: string;
    resourceKind: CatalogResourceKind;
}
export interface CatalogOfferingInput {
    sourceKey: string;
    serviceNativeCode: string;
    nativeProductId?: string;
    nativeSkuName: string;
    displayName: string;
    region: string;
    purchaseOption?: string;
    operatingSystem?: string;
    architecture?: string;
    family?: string;
    generation?: string;
    engine?: string;
    vcpu?: number;
    memoryGiB?: number;
    highAvailability?: boolean;
    attributes?: Record<string, unknown>;
    rawSource: Record<string, unknown>;
    active?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string;
}
export interface CatalogPriceTierInput {
    startQuantity: number;
    endQuantity?: number;
    unitPrice: number;
}
export interface CatalogMeterInput {
    sourceKey: string;
    serviceNativeCode: string;
    nativeSkuId: string;
    nativeMeterId?: string;
    name: string;
    region: string;
    pricingUnit: string;
    unitMultiplier?: number;
    currency?: string;
    priceType?: CatalogPriceType;
    effectiveFrom: string;
    effectiveTo?: string;
    attributes?: Record<string, unknown>;
    rawSource: Record<string, unknown>;
    tiers: CatalogPriceTierInput[];
}
export interface CatalogOfferingMeterInput {
    offeringSourceKey: string;
    meterSourceKey: string;
    quantity?: number;
}
export interface CatalogSnapshot {
    provider: CatalogProvider;
    source: string;
    version?: string;
    mode?: 'FULL' | 'PARTIAL';
    services: CatalogServiceInput[];
    offerings: CatalogOfferingInput[];
    meters: CatalogMeterInput[];
    offeringMeters: CatalogOfferingMeterInput[];
}
export interface CatalogOfferingView {
    id: string;
    provider: CatalogProvider;
    resourceKind: CatalogResourceKind;
    serviceName: string;
    serviceNativeCode: string;
    nativeProductId: string | null;
    nativeSkuName: string;
    displayName: string;
    region: string;
    purchaseOption: string;
    operatingSystem: string | null;
    architecture: string | null;
    family: string | null;
    generation: string | null;
    engine: string | null;
    vcpu: number | null;
    memoryGiB: number | null;
    highAvailability: boolean | null;
}
export interface CatalogPriceResult {
    unitPrice: number;
    estimatedCost: number;
    unit: string;
    currency: string;
    source: string;
    effectiveFrom: string;
}
