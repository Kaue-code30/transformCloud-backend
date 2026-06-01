import { Injectable, Logger } from '@nestjs/common';
import { readCatalog } from './catalog-sync.service';
import type { ServiceMapping, GcpMapping, AzureMapping, AwsMapping, OciMapping } from '../types/pipeline.types';

interface AzureCatalogItem { armSkuName: string; armRegionName: string; }
interface GcpCatalogSku    { description: string; serviceRegions: string[]; }
interface AwsCatalogFile   { products: Record<string, { attributes: { instanceType?: string; location?: string; operatingSystem?: string; tenancy?: string } }> }
interface OciCatalogFile   { items: Array<{ displayName: string; serviceCategory: string }> }

// GCP service name → catalog file ID
const GCP_SERVICE_IDS: Record<string, string> = {
  'Compute Engine': '6F81-5844-456A',
  'Cloud SQL':      '9662-B51E-5089',
  'Cloud Storage':  '95FF-2EF5-5EA1',
  'Memorystore':    'E2D0-0E09-0018',
  'Cloud Armor':    '975A-27C5-B553',
  'Cloud Run':      '152E-C115-5142',
  'BigQuery':       '24E6-581D-38E5',
};

const AWS_REGION_NAMES: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)', 'us-east-2': 'US East (Ohio)',
  'us-west-2': 'US West (Oregon)',      'sa-east-1': 'South America (Sao Paulo)',
  'eu-west-1': 'Europe (Ireland)',      'eu-central-1': 'Europe (Frankfurt)',
  'ap-southeast-1': 'Asia Pacific (Singapore)', 'ap-northeast-1': 'Asia Pacific (Tokyo)',
};

@Injectable()
export class CatalogValidatorService {
  private readonly logger = new Logger(CatalogValidatorService.name);

  /**
   * Valida cada mapeamento contra o catálogo local.
   * Se o SKU existe → eleva confidence para 'high'.
   * Se não existe → mantém confidence original (não penaliza; pode ser catálogo desatualizado).
   */
  validateAndUpgrade(mappings: ServiceMapping[]): ServiceMapping[] {
    return mappings.map((m) => ({
      ...m,
      gcp:   m.gcp   ? this.upgradeGcp(m.gcp)     : undefined,
      azure: m.azure ? this.upgradeAzure(m.azure)  : undefined,
      aws:   m.aws   ? this.upgradeAws(m.aws)      : undefined,
      oci:   m.oci   ? this.upgradeOci(m.oci)      : undefined,
    }));
  }

  // ─── GCP ─────────────────────────────────────────────────────────────────

  private upgradeGcp(m: GcpMapping): GcpMapping {
    if (m.confidence === 'high') return m;

    const serviceId = GCP_SERVICE_IDS[m.service];
    if (!serviceId) return m;

    const catalog = readCatalog<{ skus: GcpCatalogSku[] }>(`gcp-${serviceId}`);
    if (!catalog?.skus?.length) return m;

    const machineType = (m.machineType ?? '').toLowerCase();
    if (!machineType) return m;

    // Extrai família (n2, c2, e2, etc.)
    const family = machineType.split('-')[0];
    const regionLower = (m.region ?? '').toLowerCase();

    const found = catalog.skus.some((sku) => {
      const desc = sku.description.toLowerCase();
      const inRegion = !regionLower || sku.serviceRegions.some((r) => r.toLowerCase() === regionLower);
      return desc.includes(family) && inRegion;
    });

    if (found) {
      this.logger.debug(`GCP validated: ${m.service}/${m.machineType} → high`);
      return { ...m, confidence: 'high' };
    }
    return m;
  }

  // ─── Azure ────────────────────────────────────────────────────────────────

  private upgradeAzure(m: AzureMapping): AzureMapping {
    if (m.confidence === 'high') return m;

    const catalog = readCatalog<{ items: AzureCatalogItem[] }>('azure');
    if (!catalog?.items?.length) return m;

    const skuBase = (m.skuName ?? m.sku ?? '').split(' ')[0].toLowerCase();
    const regionLower = (m.region ?? '').toLowerCase();
    if (!skuBase) return m;

    const found = catalog.items.some(
      (i) =>
        i.armSkuName?.toLowerCase().includes(skuBase) &&
        (!regionLower || i.armRegionName?.toLowerCase() === regionLower),
    );

    if (found) {
      this.logger.debug(`Azure validated: ${m.service}/${m.skuName} → high`);
      return { ...m, confidence: 'high' };
    }
    return m;
  }

  // ─── AWS ─────────────────────────────────────────────────────────────────

  private upgradeAws(m: AwsMapping): AwsMapping {
    if (m.confidence === 'high') return m;
    if (!m.instanceType || !m.region) return m;

    const catalog = readCatalog<AwsCatalogFile>(`aws-${m.service}-${m.region}`);
    if (!catalog?.products) return m;

    const regionName = AWS_REGION_NAMES[m.region];
    if (!regionName) return m;

    const found = Object.values(catalog.products).some(
      (p) =>
        p.attributes.instanceType === m.instanceType &&
        p.attributes.location === regionName,
    );

    if (found) {
      this.logger.debug(`AWS validated: ${m.service}/${m.instanceType}/${m.region} → high`);
      return { ...m, confidence: 'high' };
    }
    return m;
  }

  // ─── OCI ─────────────────────────────────────────────────────────────────

  private upgradeOci(m: OciMapping): OciMapping {
    if (m.confidence === 'high') return m;
    if (!m.shape) return m;

    const catalog = readCatalog<OciCatalogFile>('oci');
    if (!catalog?.items?.length) return m;

    const shapeLower  = m.shape.toLowerCase();
    const isFlexShape = shapeLower.includes('flex');

    const found = catalog.items.some((p) => {
      const name = p.displayName.toLowerCase();
      if (isFlexShape) {
        // Flex: verifica se existe SKU OCPU da família
        const family = shapeLower.match(/(?:standard|optimized)\.?([a-z0-9]+)\.flex/i)?.[1] ?? '';
        return family && name.includes(family) && name.includes('ocpu');
      }
      // Fixed: MySQL, Redis, etc.
      return name.includes(shapeLower) || shapeLower.includes(name.split(' ')[0]);
    });

    if (found) {
      this.logger.debug(`OCI validated: ${m.shape} → high`);
      return { ...m, confidence: 'high' };
    }
    return m;
  }
}
