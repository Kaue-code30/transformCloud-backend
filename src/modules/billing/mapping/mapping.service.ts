import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../ai/claude.service';
import { CatalogFetcherService } from '../pricing/catalog-fetcher.service';
import { CatalogValidatorService } from '../catalog/catalog-validator.service';
import { lookupStaticSku } from '../pricing/sku-catalog';
import type { ParsedBilling, MappingResult, ServiceMapping } from '../types/pipeline.types';

@Injectable()
export class MappingService {
  private readonly logger = new Logger(MappingService.name);

  constructor(
    private readonly claude: ClaudeService,
    private readonly catalogFetcher: CatalogFetcherService,
    private readonly validator: CatalogValidatorService,
  ) {}

  /**
   * Estratégia A+B:
   * A) Serviços cujo instanceType está na tabela estática → mapeamento direto (confidence: high).
   * B) Serviços restantes → Claude recebe o catálogo real como constraint e mapeia.
   *
   * Resultado final combina A e B mantendo a ordem original dos serviços.
   */
  async mapServices(billing: ParsedBilling): Promise<MappingResult> {
    // Busca catálogo real em paralelo com a análise dos serviços (não bloqueia)
    const catalogPromise = this.catalogFetcher.fetchForRegion(billing.targetRegion);

    const staticMappings: ServiceMapping[] = [];
    const unmappedServices: typeof billing.topServices = [];

    // Etapa A: tabela estática
    for (const svc of billing.topServices) {
      const instanceType = extractInstanceType(svc.specs);
      const entry = instanceType ? lookupStaticSku(instanceType) : null;

      if (entry) {
        this.logger.debug(`Static hit: ${svc.name} → ${instanceType}`);
        staticMappings.push({
          original: svc.name,
          gcp: {
            service:     entry.gcp.service,
            machineType: entry.gcp.machineType,
            region:      resolveGcpRegion(billing.targetRegion),
            confidence:  'high',
          },
          azure: {
            service: entry.azure.service,
            skuName: entry.azure.skuName,
            sku:     entry.azure.sku,
            region:  resolveAzureRegion(billing.targetRegion),
            confidence: 'high',
          },
          aws: {
            service:         entry.awsService,
            instanceType:    entry.awsInstanceType,
            region:          resolveAwsRegion(billing.targetRegion),
            operatingSystem: 'Linux',
            confidence:      'high',
          },
          oci: {
            service:    entry.oci.service,
            shape:      entry.oci.shape,
            ocpu:       entry.oci.ocpu,
            memoryGb:   entry.oci.memoryGb,
            confidence: 'high',
          },
        });
      } else {
        unmappedServices.push(svc);
      }
    }

    // Se todos foram resolvidos estaticamente, nem chama Claude
    if (unmappedServices.length === 0) {
      this.logger.log(`Mapeamento 100% estático (${staticMappings.length} serviços)`);
      return { mappings: staticMappings };
    }

    // Etapa B: Claude com catálogo real como constraint
    const catalog = await catalogPromise;
    const partialBilling: ParsedBilling = { ...billing, topServices: unmappedServices };
    const claudeResult = await this.claude.mapServicesWithCatalog(partialBilling, catalog);

    this.logger.log(
      `Mapeamento: ${staticMappings.length} estáticos + ${claudeResult.mappings.length} via Claude`,
    );

    // Reordena para manter a ordem original do billing
    const claudeMap = new Map(
      claudeResult.mappings.map((m) => [m.original.toLowerCase(), m]),
    );

    const combined: ServiceMapping[] = billing.topServices.map((svc) => {
      const staticEntry = staticMappings.find(
        (m) => m.original.toLowerCase() === svc.name.toLowerCase(),
      );
      if (staticEntry) return staticEntry;

      return (
        claudeMap.get(svc.name.toLowerCase()) ?? {
          original: svc.name,
          gcp:   undefined,
          azure: undefined,
          aws:   undefined,
          oci:   undefined,
        }
      );
    });

    // Etapa C: valida cada mapeamento contra o catálogo local
    // Se o SKU existe no arquivo → eleva confidence para 'high' (elimina parciais espúrios)
    const validated = this.validator.validateAndUpgrade(combined);

    return { mappings: validated };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrai o instanceType de specs como:
 * "m7g.2xlarge, us-east-1, Linux, On-Demand"
 * "db.r6g.2xlarge, Multi-AZ, PostgreSQL 15"
 */
function extractInstanceType(specs: string): string | null {
  if (!specs) return null;
  // Primeiro token antes de vírgula/espaço que parece um instanceType AWS
  const match = specs.match(/\b([a-z][a-z0-9]+\.[a-z0-9]+(?:\.[a-z0-9]+)?)\b/i);
  return match ? match[1] : null;
}

const GCP_REGION_MAP: Record<string, string> = {
  'us-east-1':      'us-east4',
  'us-east-2':      'us-east1',
  'us-west-2':      'us-west1',
  'sa-east-1':      'southamerica-east1',
  'eu-west-1':      'europe-west1',
  'eu-central-1':   'europe-west3',
  'ap-southeast-1': 'asia-southeast1',
  'ap-northeast-1': 'asia-northeast1',
};

const AZURE_REGION_MAP: Record<string, string> = {
  'us-east-1':      'eastus',
  'us-east-2':      'eastus2',
  'us-west-2':      'westus2',
  'sa-east-1':      'brazilsouth',
  'eu-west-1':      'westeurope',
  'eu-central-1':   'germanywestcentral',
  'ap-southeast-1': 'southeastasia',
  'ap-northeast-1': 'japaneast',
};

function resolveGcpRegion(targetRegion?: string): string {
  if (!targetRegion) return 'us-east4';
  return GCP_REGION_MAP[targetRegion] ?? targetRegion;
}

function resolveAzureRegion(targetRegion?: string): string {
  if (!targetRegion) return 'eastus';
  return AZURE_REGION_MAP[targetRegion] ?? targetRegion;
}

function resolveAwsRegion(targetRegion?: string): string {
  if (!targetRegion) return 'us-east-1';
  // Se já é um identificador AWS, retorna direto
  if (/^[a-z]+-[a-z]+-\d$/.test(targetRegion)) return targetRegion;
  // Faz mapeamento reverso via GCP_REGION_MAP
  const awsEntry = Object.entries(GCP_REGION_MAP).find(([, gcp]) => gcp === targetRegion);
  return awsEntry ? awsEntry[0] : 'us-east-1';
}
