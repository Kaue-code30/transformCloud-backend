import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { AzureMapping, PriceEntry } from '../types/pipeline.types';
import { readCatalog } from '../catalog/catalog-sync.service';

interface AzureRetailPrice {
  retailPrice: number;
  unitOfMeasure: string;
  armSkuName: string;
  serviceName: string;
  armRegionName: string;
  priceType: string;
}

interface AzureApiResponse {
  Items: AzureRetailPrice[];
  NextPageLink?: string;
}

const AZURE_PRICES_API = 'https://prices.azure.com/api/retail/prices';

// Serviços que usam `contains` em vez de `eq` no armSkuName
// porque o SKU exato pode ter sufixos (ex: "Standard_D2s_v3 Low Priority")
const SERVICES_WITH_CONTAINS: Set<string> = new Set([
  'Azure Cache for Redis',
  'Azure Blob Storage',
  'Azure Database for PostgreSQL Flexible Server',
  'Azure Database for MySQL Flexible Server',
]);

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout (${timeoutMs}ms)`)); });
    req.on('error', reject);
  });
}

@Injectable()
export class AzurePricingService {
  private readonly logger = new Logger(AzurePricingService.name);

  async getPrice(mapping: AzureMapping, quantityHours: number): Promise<PriceEntry> {
    const skuName = mapping.skuName ?? mapping.sku;

    if (!skuName || !mapping.region) {
      return { price: null, verified: false, reason: 'Parâmetros insuficientes no mapeamento' };
    }

    // 1. Tenta encontrar no catálogo local (gerado pelo CatalogSyncService)
    const localResult = this.findInLocalCatalog(skuName, mapping.region);
    if (localResult) {
      this.logger.debug(`Azure local hit: ${localResult.armSkuName} — $${localResult.retailPrice}/${localResult.unitOfMeasure}`);
      return {
        price: localResult.retailPrice,
        unit: localResult.unitOfMeasure,
        estimatedMonthly: Number((localResult.retailPrice * quantityHours).toFixed(2)),
        source: 'Azure Retail Prices API (cache)',
        verified: true,
      };
    }

    // 2. Fallback: consulta a API em tempo real
    const attempts = buildQueryAttempts(skuName, mapping.region, mapping.service);

    for (const attempt of attempts) {
      const url = `${AZURE_PRICES_API}?$filter=${encodeURIComponent(attempt.filter)}`;
      this.logger.debug(`Azure query (${attempt.label}): ${url}`);

      try {
        const body = await httpsGet(url, 25000);
        const data: AzureApiResponse = JSON.parse(body) as AzureApiResponse;

        if (!data.Items?.length) continue;

        const candidates = data.Items.filter((i) => i.retailPrice > 0);
        if (!candidates.length) continue;

        const item = candidates.reduce((min, cur) =>
          cur.retailPrice < min.retailPrice ? cur : min,
        );

        this.logger.debug(`Azure match (${attempt.label}): ${item.armSkuName} — $${item.retailPrice}/${item.unitOfMeasure}`);

        return {
          price: item.retailPrice,
          unit: item.unitOfMeasure,
          estimatedMonthly: Number((item.retailPrice * quantityHours).toFixed(2)),
          source: 'Azure Retail Prices API',
          verified: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Azure query falhou (${attempt.label}): ${msg}`);
      }
    }

    this.logger.warn(`Azure: nenhum resultado para SKU "${skuName}" na região "${mapping.region}"`);
    return {
      price: null,
      verified: false,
      reason: `SKU "${skuName}" não encontrado na região ${mapping.region}`,
    };
  }

  private findInLocalCatalog(skuName: string, region: string): AzureRetailPrice | null {
    const catalog = readCatalog<{ items: AzureRetailPrice[] }>('azure');
    if (!catalog?.items?.length) return null;

    const skuBase = skuName.split(' ')[0].toLowerCase();
    const regionLower = region.toLowerCase();

    const candidates = catalog.items.filter(
      (i) =>
        i.retailPrice > 0 &&
        i.armSkuName?.toLowerCase().includes(skuBase) &&
        i.armRegionName?.toLowerCase() === regionLower &&
        i.priceType === 'Consumption',
    );

    if (!candidates.length) return null;
    return candidates.reduce((min, cur) => (cur.retailPrice < min.retailPrice ? cur : min));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface QueryAttempt {
  label: string;
  filter: string;
}

function buildQueryAttempts(
  skuName: string,
  region: string,
  service?: string,
): QueryAttempt[] {
  const skuBase = skuName.split(' ')[0]; // remove sufixos como " Windows"
  const useContains = service ? SERVICES_WITH_CONTAINS.has(service) : false;
  const skuFilter = useContains
    ? `contains(armSkuName,'${skuBase}')`
    : `armSkuName eq '${skuBase}'`;

  return [
    // 1. Exact SKU + região + Consumption
    {
      label: 'exact+region',
      filter: [skuFilter, `armRegionName eq '${region}'`, `priceType eq 'Consumption'`].join(' and '),
    },
    // 2. Contains SKU (se ainda não usou contains) + região + Consumption
    ...(useContains ? [] : [{
      label: 'contains+region',
      filter: [`contains(armSkuName,'${skuBase}')`, `armRegionName eq '${region}'`, `priceType eq 'Consumption'`].join(' and '),
    }]),
    // 3. Contains SKU sem região (fallback global)
    {
      label: 'contains+no-region',
      filter: [`contains(armSkuName,'${skuBase}')`, `priceType eq 'Consumption'`].join(' and '),
    },
  ];
}
