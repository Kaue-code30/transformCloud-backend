-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM (
    'COMPUTE_VM',
    'MANAGED_POSTGRES',
    'MANAGED_MYSQL',
    'OBJECT_STORAGE',
    'BLOCK_STORAGE',
    'REDIS_CACHE',
    'KUBERNETES',
    'LOAD_BALANCER',
    'WAF',
    'DATA_TRANSFER'
);

-- CreateEnum
CREATE TYPE "CatalogPriceType" AS ENUM ('ON_DEMAND', 'RESERVED', 'SPOT', 'SAVINGS_PLAN', 'OTHER');

-- CreateEnum
CREATE TYPE "MappingOverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CatalogSyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "provider_services" (
    "id" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "nativeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceKind" "ResourceKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_offerings" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "nativeProductId" TEXT,
    "nativeSkuName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "purchaseOption" TEXT NOT NULL DEFAULT 'ON_DEMAND',
    "operatingSystem" TEXT,
    "architecture" TEXT,
    "family" TEXT,
    "generation" TEXT,
    "engine" TEXT,
    "vcpu" DECIMAL(10,2),
    "memoryGiB" DECIMAL(12,3),
    "highAvailability" BOOLEAN,
    "attributes" JSONB NOT NULL,
    "rawSource" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_meters" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "nativeSkuId" TEXT NOT NULL,
    "nativeMeterId" TEXT,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "pricingUnit" TEXT NOT NULL,
    "unitMultiplier" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "priceType" "CatalogPriceType" NOT NULL DEFAULT 'ON_DEMAND',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "attributes" JSONB NOT NULL,
    "rawSource" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offering_meters" (
    "offeringId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,

    CONSTRAINT "offering_meters_pkey" PRIMARY KEY ("offeringId", "meterId")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "startQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "endQuantity" DECIMAL(20,6),
    "unitPrice" DECIMAL(20,10) NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_overrides" (
    "id" TEXT NOT NULL,
    "sourceOfferingId" TEXT NOT NULL,
    "targetProvider" "CloudProvider" NOT NULL,
    "targetOfferingId" TEXT NOT NULL,
    "status" "MappingOverrideStatus" NOT NULL DEFAULT 'APPROVED',
    "reason" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_sync_runs" (
    "id" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT,
    "status" "CatalogSyncStatus" NOT NULL,
    "importedItems" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "catalog_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_services_provider_nativeCode_key" ON "provider_services"("provider", "nativeCode");
CREATE INDEX "provider_services_resourceKind_provider_idx" ON "provider_services"("resourceKind", "provider");
CREATE UNIQUE INDEX "provider_offerings_sourceKey_key" ON "provider_offerings"("sourceKey");
CREATE INDEX "provider_offerings_provider_region_nativeSkuName_idx" ON "provider_offerings"("provider", "region", "nativeSkuName");
CREATE INDEX "provider_offerings_provider_active_idx" ON "provider_offerings"("provider", "active");
CREATE INDEX "provider_offerings_serviceId_active_idx" ON "provider_offerings"("serviceId", "active");
CREATE UNIQUE INDEX "provider_meters_sourceKey_key" ON "provider_meters"("sourceKey");
CREATE INDEX "provider_meters_provider_nativeSkuId_region_idx" ON "provider_meters"("provider", "nativeSkuId", "region");
CREATE INDEX "provider_meters_serviceId_priceType_currency_idx" ON "provider_meters"("serviceId", "priceType", "currency");
CREATE UNIQUE INDEX "price_tiers_meterId_startQuantity_key" ON "price_tiers"("meterId", "startQuantity");
CREATE UNIQUE INDEX "mapping_overrides_sourceOfferingId_targetProvider_key" ON "mapping_overrides"("sourceOfferingId", "targetProvider");
CREATE INDEX "mapping_overrides_targetOfferingId_idx" ON "mapping_overrides"("targetOfferingId");
CREATE INDEX "catalog_sync_runs_provider_startedAt_idx" ON "catalog_sync_runs"("provider", "startedAt");

-- AddForeignKey
ALTER TABLE "provider_offerings" ADD CONSTRAINT "provider_offerings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "provider_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_meters" ADD CONSTRAINT "provider_meters_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "provider_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offering_meters" ADD CONSTRAINT "offering_meters_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "provider_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offering_meters" ADD CONSTRAINT "offering_meters_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "provider_meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "provider_meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mapping_overrides" ADD CONSTRAINT "mapping_overrides_sourceOfferingId_fkey" FOREIGN KEY ("sourceOfferingId") REFERENCES "provider_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mapping_overrides" ADD CONSTRAINT "mapping_overrides_targetOfferingId_fkey" FOREIGN KEY ("targetOfferingId") REFERENCES "provider_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
