import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Catálogos ficam em <project-root>/catalogs/ — gitignored
const CATALOGS_DIR = path.resolve(process.cwd(), 'catalogs');
// TTL: re-sincroniza se o arquivo tiver mais de 24h
const TTL_MS = 24 * 60 * 60 * 1000;

// IDs dos serviços GCP que buscamos
const GCP_SERVICE_IDS: Record<string, string> = {
  'Compute Engine': '6F81-5844-456A',
  'Cloud SQL':      '9662-B51E-5089',
  'Cloud Storage':  '95FF-2EF5-5EA1',
  'Memorystore':    'E2D0-0E09-0018',
  'Cloud Armor':    '975A-27C5-B553',
  'Cloud Run':      '152E-C115-5142',
  'BigQuery':       '24E6-581D-38E5',
};

// Serviços e regiões AWS que cobrimos
const AWS_SERVICES = ['AmazonEC2', 'AmazonRDS', 'AmazonElastiCache', 'AmazonS3'];
const AWS_REGIONS  = ['us-east-1', 'us-east-2', 'us-west-2', 'sa-east-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1'];

// SKUs Azure mais relevantes para sampling do catálogo
const AZURE_SERVICES_SAMPLE = [
  'Virtual Machines',
  'Azure Database for PostgreSQL Flexible Server',
  'Azure Database for MySQL Flexible Server',
  'Azure Cache for Redis',
  'Azure Blob Storage',
  'Azure Application Gateway',
];
const AZURE_REGIONS_SAMPLE = ['eastus', 'brazilsouth', 'westeurope', 'southeastasia'];

function httpsGet(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout ${timeoutMs}ms: ${url}`)); });
    req.on('error', reject);
  });
}

function isStale(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs > TTL_MS;
  } catch {
    return true; // arquivo não existe
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function catalogPath(name: string): string {
  return path.join(CATALOGS_DIR, `${name}.json`);
}

export function readCatalog<T>(name: string): T | null {
  const p = catalogPath(name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

@Injectable()
export class CatalogSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(private readonly config: ConfigService) {}

  // Roda automaticamente após o servidor inicializar — não bloqueia o startup
  onApplicationBootstrap(): void {
    this.syncAll().catch((err) => {
      this.logger.error(`Sync de catálogos falhou: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async syncAll(): Promise<void> {
    this.logger.log('Iniciando sync de catálogos de preços...');

    // Roda todos em paralelo — cada um verifica TTL individualmente
    await Promise.allSettled([
      this.syncOci(),
      this.syncGcp(),
      this.syncAzure(),
      ...AWS_SERVICES.flatMap((svc) =>
        AWS_REGIONS.map((region) => this.syncAws(svc, region)),
      ),
    ]);

    this.logger.log('Sync de catálogos concluído.');
  }

  // ─── OCI ─────────────────────────────────────────────────────────────────

  async syncOci(): Promise<void> {
    const file = catalogPath('oci');
    if (!isStale(file)) { this.logger.debug('OCI catálogo em cache (< 24h)'); return; }

    this.logger.log('OCI: sincronizando catálogo...');
    const body = await httpsGet('https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/', 60_000);
    const data = JSON.parse(body) as { items: unknown[] };

    // Salva o catálogo completo — pricing service busca nele por displayName/serviceCategory
    writeJson(file, { lastSync: new Date().toISOString(), items: data.items ?? [] });
    this.logger.log(`OCI: ${data.items?.length ?? 0} produtos salvos em ${file}`);
  }

  // ─── GCP ─────────────────────────────────────────────────────────────────

  async syncGcp(): Promise<void> {
    const apiKey = this.config.get<string>('GCP_API_KEY');
    if (!apiKey || apiKey.includes('COLOQUE')) {
      this.logger.warn('GCP: GCP_API_KEY não configurada, sync pulado');
      return;
    }

    for (const [serviceName, serviceId] of Object.entries(GCP_SERVICE_IDS)) {
      const file = catalogPath(`gcp-${serviceId}`);
      if (!isStale(file)) { this.logger.debug(`GCP ${serviceName} em cache`); continue; }

      this.logger.log(`GCP: sincronizando ${serviceName}...`);
      try {
        const skus = await this.fetchGcpAllSkus(serviceId, apiKey);
        writeJson(file, { lastSync: new Date().toISOString(), service: serviceName, serviceId, skus });
        this.logger.log(`GCP ${serviceName}: ${skus.length} SKUs salvos`);
      } catch (err) {
        this.logger.warn(`GCP ${serviceName} sync falhou: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async fetchGcpAllSkus(serviceId: string, apiKey: string): Promise<unknown[]> {
    const all: unknown[] = [];
    let pageToken: string | undefined;
    let page = 0;

    do {
      const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const url = `https://cloudbilling.googleapis.com/v1/services/${serviceId}/skus?currencyCode=USD&pageSize=5000${tokenParam}&key=${apiKey}`;
      const body = await httpsGet(url, 30_000);
      const data = JSON.parse(body) as { skus: unknown[]; nextPageToken?: string };

      if (!data.skus?.length) break;
      all.push(...data.skus);
      pageToken = data.nextPageToken;
      page++;
    } while (pageToken && page < 10);

    return all;
  }

  // ─── Azure ────────────────────────────────────────────────────────────────

  async syncAzure(): Promise<void> {
    const file = catalogPath('azure');
    if (!isStale(file)) { this.logger.debug('Azure catálogo em cache'); return; }

    this.logger.log('Azure: sincronizando catálogo...');
    const all: unknown[] = [];

    await Promise.allSettled(
      AZURE_SERVICES_SAMPLE.flatMap((svc) =>
        AZURE_REGIONS_SAMPLE.map(async (region) => {
          try {
            const filter = encodeURIComponent(
              `serviceName eq '${svc}' and armRegionName eq '${region}' and priceType eq 'Consumption'`,
            );
            const body = await httpsGet(
              `https://prices.azure.com/api/retail/prices?$filter=${filter}&$top=500`,
              15_000,
            );
            const data = JSON.parse(body) as { Items?: unknown[]; items?: unknown[] };
            const items = data.Items ?? data.items ?? [];
            all.push(...items);
          } catch (err) {
            this.logger.warn(`Azure sync ${svc}/${region}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      ),
    );

    writeJson(file, { lastSync: new Date().toISOString(), items: all });
    this.logger.log(`Azure: ${all.length} SKUs salvos`);
  }

  // ─── AWS ─────────────────────────────────────────────────────────────────

  async syncAws(service: string, region: string): Promise<void> {
    const file = catalogPath(`aws-${service}-${region}`);
    if (!isStale(file)) { this.logger.debug(`AWS ${service}/${region} em cache`); return; }

    this.logger.log(`AWS: sincronizando ${service}/${region}...`);
    try {
      const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/${region}/index.json`;
      const body = await httpsGet(url, 120_000);

      if (body.trimStart().startsWith('<')) {
        this.logger.warn(`AWS ${service}/${region}: sem catálogo de preços por hora (resposta XML)`);
        return;
      }

      const data = JSON.parse(body) as { products?: Record<string, unknown>; terms?: unknown };
      const productCount = Object.keys(data.products ?? {}).length;

      writeJson(file, {
        lastSync: new Date().toISOString(),
        service,
        region,
        products: data.products ?? {},
        terms: data.terms ?? {},
      });

      this.logger.log(`AWS ${service}/${region}: ${productCount} produtos salvos`);
    } catch (err) {
      this.logger.warn(`AWS ${service}/${region} sync falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
