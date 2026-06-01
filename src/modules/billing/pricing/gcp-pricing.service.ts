import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GcpMapping, PriceEntry } from '../types/pipeline.types';
import { readCatalog } from '../catalog/catalog-sync.service';

const GCP_BILLING_API = 'https://cloudbilling.googleapis.com/v1/services';

// IDs dos serviços na Cloud Billing API
// Fonte: https://cloud.google.com/billing/v1/how-tos/catalog-api
const GCP_SERVICE_IDS: Record<string, string> = {
  'Compute Engine':  '6F81-5844-456A',
  'Cloud SQL':       '9662-B51E-5089',
  'Cloud Storage':   '95FF-2EF5-5EA1',
  'Cloud Run':       '152E-C115-5142',
  'BigQuery':        '24E6-581D-38E5',
  'Memorystore':     'E2D0-0E09-0018',  // Memorystore for Redis/Valkey
  'AlloyDB':         '9BAE-B4E0-5BF3',  // AlloyDB for PostgreSQL
  'Cloud Armor':     '975A-27C5-B553',  // Google Cloud Armor
};

// Termos de busca por família de máquina GCP
// O catálogo usa nomes como "N2 Instance Core" ou "Tau T2A Instance Core"
const MACHINE_FAMILY_TERMS: Record<string, string[]> = {
  'n1':  ['n1 predefined instance core', 'n1 instance core'],
  'n2':  ['n2 instance core', 'n2 custom instance core'],
  'n2d': ['n2d amd instance core'],
  'n4':  ['n4 instance core'],
  'c2':  ['compute optimized core'],
  'c2d': ['c2d amd compute optimized core'],
  'c3':  ['c3 instance core'],
  'c3a': ['c3a arm instance core'],
  'c4':  ['c4 instance core'],
  'c4a': ['c4a arm instance core'],
  'e2':  ['e2 instance core'],
  'm1':  ['memory-optimized instance core'],
  'm2':  ['memory-optimized upgrade instance core'],
  'm3':  ['m3 instance core'],
  'a2':  ['a2 instance core'],
  'a3':  ['a3 instance core'],
  'g2':  ['g2 instance core'],
  't2a': ['tau t2a instance core'],
  't2d': ['tau t2d amd instance core'],
  // Cloud SQL
  'db-custom': ['db custom core', 'sql zonal - db custom core'],
  'db-n1':     ['db n1 standard', 'sql zonal - db n1'],
  'db-n2':     ['db n2 standard', 'sql zonal - db n2'],
  'db-highmem':['db highmem', 'sql zonal - db highmem'],
  // Memorystore
  'm1-ultra':  ['memorystore for redis ultra'],
  'm1-standard':['memorystore for redis standard'],
  // Catch-all para armazenamento
  'standard':  ['standard storage'],
  'nearline':  ['nearline storage'],
  'coldline':  ['coldline storage'],
};

interface GcpSku {
  description: string;
  pricingInfo: Array<{
    pricingExpression: {
      usageUnit: string;
      tieredRates: Array<{
        unitPrice: { units: string; nanos: number };
      }>;
    };
  }>;
  serviceRegions: string[];
}

interface GcpSkuListResponse {
  skus: GcpSku[];
  nextPageToken?: string;
}

@Injectable()
export class GcpPricingService {
  private readonly logger = new Logger(GcpPricingService.name);

  constructor(private readonly config: ConfigService) {}

  async getPrice(mapping: GcpMapping, quantityHours: number): Promise<PriceEntry> {
    const apiKey = this.config.get<string>('GCP_API_KEY');
    if (!apiKey || apiKey.includes('COLOQUE_SUA')) {
      return { price: null, verified: false, reason: 'GCP_API_KEY não configurada' };
    }

    const serviceId = resolveServiceId(mapping.service);
    if (!serviceId) {
      return { price: null, verified: false, reason: `Serviço GCP "${mapping.service}" não reconhecido` };
    }

    const region = mapping.region ? mapping.region.toLowerCase().replace(/_/g, '-') : null;
    if (!region) {
      return { price: null, verified: false, reason: 'Região GCP não informada' };
    }

    const searchTerms = extractSearchTerms(mapping);
    if (!searchTerms.length) {
      return { price: null, verified: false, reason: 'Não foi possível extrair termo de busca do mapeamento' };
    }

    try {
      // Busca com paginação — segue nextPageToken até encontrar ou esgotar
      const skus = await fetchAllSkus(serviceId, apiKey, this.logger);

      for (const term of searchTerms) {
        // Tenta com região primeiro, depois sem
        let sku = findSku(skus, term, region);
        if (!sku) sku = findSku(skus, term, null);

        if (sku) {
          const unitPrice = extractUnitPrice(sku);
          if (unitPrice !== null) {
            this.logger.debug(`GCP match: "${sku.description}" (termo: "${term}") — $${unitPrice}/h`);
            return {
              price: unitPrice,
              unit: 'hora',
              estimatedMonthly: Number((unitPrice * quantityHours).toFixed(2)),
              source: 'GCP Cloud Billing API',
              verified: true,
            };
          }
        }
      }

      this.logger.warn(`GCP: nenhum SKU encontrado para ${mapping.service} (termos: ${searchTerms.join(', ')}) em ${region}`);
      return {
        price: null,
        verified: false,
        reason: `Nenhum SKU encontrado para ${mapping.service} em ${region}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro GCP Billing API (${mapping.service}): ${msg}`);
      return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveServiceId(rawName: string): string | null {
  const lower = rawName.toLowerCase().trim();
  for (const [name, id] of Object.entries(GCP_SERVICE_IDS)) {
    if (lower === name.toLowerCase()) return id;
    if (lower.startsWith(name.toLowerCase())) return id;
    if (lower.includes(name.toLowerCase())) return id;
  }
  return null;
}

// Termos de busca por nome de serviço GCP (quando não há machineType)
const SERVICE_FALLBACK_TERMS: Record<string, string[]> = {
  'cloud armor':   ['cloud armor policy', 'cloud armor'],
  'memorystore':   ['memorystore for redis', 'memorystore redis', 'memorystore'],
  'cloud storage': ['standard storage', 'multi-regional storage', 'regional storage'],
  'bigquery':      ['bigquery analysis', 'bigquery storage', 'bigquery'],
  'cloud run':     ['cloud run requests', 'cloud run cpu', 'cloud run'],
  'alloydb':       ['alloydb for postgresql', 'alloydb'],
};

// Retorna múltiplos termos candidatos, do mais específico ao mais genérico
function extractSearchTerms(mapping: GcpMapping): string[] {
  // 1. Termos específicos por serviço têm prioridade máxima
  // Cloud Armor, Memorystore, Cloud Storage, etc. não usam machineType
  const svcLower = mapping.service.toLowerCase();
  for (const [svc, terms] of Object.entries(SERVICE_FALLBACK_TERMS)) {
    if (svcLower.includes(svc)) return terms;
  }

  // 2. Para serviços com machineType: deriva termos por família
  const raw = (mapping.machineType ?? mapping.tier ?? '').toLowerCase().trim();
  if (!raw) return [];

  for (const [family, terms] of Object.entries(MACHINE_FAMILY_TERMS)) {
    if (raw.startsWith(family) || raw === family) {
      return terms;
    }
  }

  // 3. Fallback genérico por prefixo
  const family = raw.split('-')[0];
  if (family) {
    return [
      `${family} instance core`,
      `${family} custom instance core`,
      `${family} instance`,
      family,
    ];
  }

  return [];
}

async function fetchAllSkus(serviceId: string, apiKey: string, logger: Logger): Promise<GcpSku[]> {
  // 1. Tenta ler do arquivo local gerado pelo CatalogSyncService
  const cached = readCatalog<{ skus: GcpSku[] }>(`gcp-${serviceId}`);
  if (cached?.skus?.length) {
    logger.debug(`GCP: usando catálogo local para ${serviceId} (${cached.skus.length} SKUs)`);
    return cached.skus as GcpSku[];
  }

  // 2. Fallback: busca paginada direta na API
  logger.warn(`GCP: arquivo de catálogo não encontrado para ${serviceId}, buscando na API...`);
  const allSkus: GcpSku[] = [];
  let pageToken: string | undefined;
  let page = 0;
  const maxPages = 5;

  do {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `${GCP_BILLING_API}/${serviceId}/skus?currencyCode=USD&pageSize=5000${tokenParam}&key=${apiKey}`;

    const body = await httpsGet(url, 25000);
    const data: GcpSkuListResponse = JSON.parse(body) as GcpSkuListResponse;

    if (!data.skus?.length) break;
    allSkus.push(...data.skus);
    pageToken = data.nextPageToken;
    page++;

    logger.debug(`GCP SKUs carregados: ${allSkus.length} (página ${page})`);
  } while (pageToken && page < maxPages);

  return allSkus;
}

function findSku(skus: GcpSku[], searchTerm: string, region: string | null): GcpSku | null {
  const term = searchTerm.toLowerCase();
  return (
    skus.find((s) => {
      const descMatch = s.description.toLowerCase().includes(term);
      if (!descMatch) return false;
      if (!region) return true;
      return s.serviceRegions.some((r) => r.toLowerCase() === region);
    }) ?? null
  );
}

function extractUnitPrice(sku: GcpSku): number | null {
  const pricing = sku.pricingInfo?.[0]?.pricingExpression;
  if (!pricing) return null;

  // Pega a primeira taxa com preço > 0
  const rate = pricing.tieredRates?.find((r) => {
    const units = parseInt(r.unitPrice.units || '0');
    return units > 0 || r.unitPrice.nanos > 0;
  }) ?? pricing.tieredRates?.[0];

  if (!rate) return null;

  const price = parseInt(rate.unitPrice.units || '0') + rate.unitPrice.nanos / 1e9;
  return price > 0 ? Number(price.toFixed(6)) : null;
}

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
