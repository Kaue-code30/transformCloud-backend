import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import {
  VALID_GCP_MACHINE_TYPES,
  VALID_GCP_SERVICES,
  VALID_AZURE_SERVICES,
  VALID_AWS_SERVICES,
  VALID_OCI_SHAPES,
  VALID_OCI_SERVICES,
} from './sku-catalog';

export interface AvailableCatalog {
  azure: { services: string[]; skus: string[] };
  gcp:   { services: string[]; machineTypes: string[] };
  aws:   { services: string[] };
  oci:   { services: string[]; shapes: string[] };
}

interface AzureRetailPrice {
  armSkuName: string;
  serviceName: string;
}

const AZURE_PRICES_API = 'https://prices.azure.com/api/retail/prices';

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

@Injectable()
export class CatalogFetcherService {
  private readonly logger = new Logger(CatalogFetcherService.name);

  /**
   * Monta o catálogo disponível para a região alvo.
   * Azure: consulta a API real para obter SKUs disponíveis na região.
   * GCP / AWS / OCI: retorna as listas estáticas curadas (sem custo de latência).
   */
  async fetchForRegion(targetRegion?: string): Promise<AvailableCatalog> {
    const [azureCatalog] = await Promise.all([
      this.fetchAzureSkus(targetRegion),
    ]);

    return {
      azure: azureCatalog,
      gcp:   { services: VALID_GCP_SERVICES,  machineTypes: VALID_GCP_MACHINE_TYPES },
      aws:   { services: VALID_AWS_SERVICES },
      oci:   { services: VALID_OCI_SERVICES,   shapes: VALID_OCI_SHAPES },
    };
  }

  // ─── Azure ────────────────────────────────────────────────────────────────

  private async fetchAzureSkus(
    targetRegion?: string,
  ): Promise<AvailableCatalog['azure']> {
    const region = this.resolveAzureRegion(targetRegion);

    // Busca os serviços mais relevantes para ter uma lista representativa.
    // Uma única query por serviceName é suficiente — não precisamos de todos os SKUs.
    const servicesToSample = [
      'Virtual Machines',
      'Azure Database for PostgreSQL Flexible Server',
      'Azure Cache for Redis',
    ];

    const skuSet = new Set<string>();

    await Promise.all(
      servicesToSample.map(async (svc) => {
        try {
          const skus = await this.fetchAzureSkusForService(svc, region);
          skus.forEach((s) => skuSet.add(s));
        } catch {
          // falha silenciosa — fallback para lista estática
        }
      }),
    );

    // Se a API não retornou nada (ex: região sem cobertura), usa lista estática
    if (skuSet.size === 0) {
      this.logger.warn(`Azure catalog vazio para região ${region} — usando lista estática`);
      const { VALID_AZURE_SKUS } = await import('./sku-catalog.js');
      VALID_AZURE_SKUS.forEach((s) => skuSet.add(s));
    }

    return {
      services: VALID_AZURE_SERVICES,
      skus: Array.from(skuSet).sort(),
    };
  }

  private async fetchAzureSkusForService(
    serviceName: string,
    region: string,
  ): Promise<string[]> {
    const filter = encodeURIComponent(
      `serviceName eq '${serviceName}' and armRegionName eq '${region}' and priceType eq 'Consumption'`,
    );
    const url = `${AZURE_PRICES_API}?$filter=${filter}&$top=200`;

    const body = await httpsGet(url, 10000);
    // A Azure Retail Prices API retorna Items com I maiúsculo
    const data = JSON.parse(body) as { Items?: AzureRetailPrice[]; items?: AzureRetailPrice[] };

    const items = data.Items ?? data.items ?? [];
    return items
      .map((i) => i.armSkuName)
      .filter((s) => s && s.trim().length > 0);
  }

  // Converte targetRegion (ex: "Brasil", "sa-east-1") para identificador Azure
  private resolveAzureRegion(targetRegion?: string): string {
    if (!targetRegion) return 'eastus';

    const lower = targetRegion.toLowerCase();

    const MAP: [string | RegExp, string][] = [
      [/brasil|brazil|sa-east|southamerica/,     'brazilsouth'],
      [/us.east.1|us.east.2|us east|n\.virginia|ohio/, 'eastus'],
      [/us.west|oregon|california/,               'westus2'],
      [/europe|eu.west|ireland|eu.central|frankfurt/, 'westeurope'],
      [/asia|singapore|ap.southeast/,             'southeastasia'],
      [/tokyo|japan|ap.northeast/,                'japaneast'],
    ];

    for (const [pattern, azureRegion] of MAP) {
      if (typeof pattern === 'string' ? lower.includes(pattern) : pattern.test(lower)) {
        return azureRegion;
      }
    }

    // Se parece ser já um identificador Azure, usa diretamente
    if (/^[a-z]+$/.test(targetRegion)) return targetRegion;

    return 'eastus';
  }
}
