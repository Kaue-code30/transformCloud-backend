import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CatalogRepository } from './catalog.repository';
import { CatalogImportService } from './catalog-import.service';
import { CatalogPricingService } from './catalog-pricing.service';
import { AwsCatalogAdapter } from './providers/aws/aws-catalog.adapter';
import { AzureCatalogAdapter } from './providers/azure/azure-catalog.adapter';
import { GcpCatalogAdapter } from './providers/gcp/gcp-catalog.adapter';
import { OciCatalogAdapter } from './providers/oci/oci-catalog.adapter';

@Module({
  imports: [PrismaModule],
  providers: [
    CatalogRepository,
    CatalogImportService,
    CatalogPricingService,
    AwsCatalogAdapter,
    AzureCatalogAdapter,
    GcpCatalogAdapter,
    OciCatalogAdapter,
  ],
  exports: [
    CatalogRepository,
    CatalogImportService,
    CatalogPricingService,
    AwsCatalogAdapter,
    AzureCatalogAdapter,
    GcpCatalogAdapter,
    OciCatalogAdapter,
  ],
})
export class CatalogModule {}
