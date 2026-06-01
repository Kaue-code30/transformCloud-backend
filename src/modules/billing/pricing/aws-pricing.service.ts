import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { PriceEntry } from '../types/pipeline.types';

const AWS_PRICING_API = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws';

interface AwsPricingTerm {
  priceDimensions: Record<string, {
    pricePerUnit: { USD: string };
    unit: string;
  }>;
}

interface AwsPricingProduct {
  attributes: {
    instanceType?: string;
    operatingSystem?: string;
    tenancy?: string;
    location?: string;
    databaseEngine?: string;
    deploymentOption?: string;
    cacheEngine?: string;
    usagetype?: string;
  };
}

interface AwsOffersFile {
  products: Record<string, AwsPricingProduct>;
  terms: { OnDemand?: Record<string, Record<string, AwsPricingTerm>> };
}

export interface AwsPricingParams {
  service: string;
  region: string;
  instanceType?: string;
  operatingSystem?: string;
  databaseEngine?: string;
}

const AWS_REGION_NAMES: Record<string, string> = {
  'us-east-1':      'US East (N. Virginia)',
  'us-east-2':      'US East (Ohio)',
  'us-west-1':      'US West (N. California)',
  'us-west-2':      'US West (Oregon)',
  'eu-west-1':      'Europe (Ireland)',
  'eu-west-2':      'Europe (London)',
  'eu-central-1':   'Europe (Frankfurt)',
  'eu-north-1':     'Europe (Stockholm)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-south-1':     'Asia Pacific (Mumbai)',
  'sa-east-1':      'South America (Sao Paulo)',
  'ca-central-1':   'Canada (Central)',
};

// Cache por "service/region" — carregado uma vez, reutilizado em todas as chamadas
// Determinístico: elimina a variabilidade do streaming parcial
const catalogCache = new Map<string, Promise<AwsOffersFile>>();

function fetchJson(url: string, timeoutMs: number): Promise<AwsOffersFile> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as AwsOffersFile);
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout ${timeoutMs}ms`)); });
    req.on('error', reject);
  });
}

@Injectable()
export class AwsPricingService {
  private readonly logger = new Logger(AwsPricingService.name);

  async getPrice(params: AwsPricingParams, quantityHours: number): Promise<PriceEntry> {
    const regionName = AWS_REGION_NAMES[params.region];
    if (!regionName) {
      return { price: null, verified: false, reason: `Região AWS ${params.region} não mapeada` };
    }
    if (!params.instanceType) {
      return { price: null, verified: false, reason: 'instanceType não informado' };
    }

    try {
      const catalog = await this.loadCatalog(params.service, params.region);
      const sku = this.findSku(catalog, params, regionName);

      if (!sku) {
        return {
          price: null,
          verified: false,
          reason: `${params.instanceType} não encontrado no catálogo AWS ${params.service}/${params.region}`,
        };
      }

      const hourlyPrice = this.extractPrice(catalog, sku);
      if (hourlyPrice === null) {
        return { price: null, verified: false, reason: 'Preço OnDemand não encontrado para o SKU' };
      }

      this.logger.debug(`AWS match: ${params.service} ${params.instanceType}/${params.region} — $${hourlyPrice}/h`);

      return {
        price: hourlyPrice,
        unit: 'hora',
        estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
        source: 'AWS Pricing API',
        verified: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AWS Pricing error (${params.service}/${params.region}): ${msg}`);
      return { price: null, verified: false, reason: `Erro AWS Pricing: ${msg}` };
    }
  }

  // ─── Cache por service+region ─────────────────────────────────────────────

  private loadCatalog(service: string, region: string): Promise<AwsOffersFile> {
    const key = `${service}/${region}`;
    if (!catalogCache.has(key)) {
      const url = `${AWS_PRICING_API}/${service}/current/${region}/index.json`;
      this.logger.log(`AWS: carregando catálogo ${key}...`);
      // Timeout de 90s — arquivos chegam a ~100MB mas o download acontece uma só vez
      const promise = fetchJson(url, 90_000).then((data) => {
        this.logger.log(`AWS: catálogo ${key} carregado (${Object.keys(data.products ?? {}).length} produtos)`);
        return data;
      });
      catalogCache.set(key, promise);
    }
    return catalogCache.get(key)!;
  }

  // ─── Busca determinística no catálogo ────────────────────────────────────

  private findSku(catalog: AwsOffersFile, params: AwsPricingParams, regionName: string): string | null {
    for (const [sku, product] of Object.entries(catalog.products ?? {})) {
      const a = product.attributes;
      if (a.location !== regionName) continue;
      if (a.instanceType !== params.instanceType) continue;

      if (params.service === 'AmazonEC2') {
        const os = params.operatingSystem ?? 'Linux';
        if (a.operatingSystem !== os) continue;
        if (a.tenancy !== 'Shared') continue;
        // Exclui instâncias dedicadas e bare metal
        if (a.usagetype?.includes('Dedicated') || a.usagetype?.includes('Host')) continue;
      } else if (params.service === 'AmazonRDS') {
        if (a.deploymentOption && a.deploymentOption !== 'Single-AZ') continue;
        if (params.databaseEngine) {
          const engine = a.databaseEngine?.toLowerCase() ?? '';
          if (!engine.includes(params.databaseEngine.toLowerCase())) continue;
        }
      }

      return sku;
    }
    return null;
  }

  private extractPrice(catalog: AwsOffersFile, sku: string): number | null {
    const onDemand = catalog.terms?.OnDemand?.[sku];
    if (!onDemand) return null;

    for (const term of Object.values(onDemand)) {
      for (const dim of Object.values(term.priceDimensions)) {
        const usd = parseFloat(dim.pricePerUnit.USD);
        if (!isNaN(usd) && usd > 0) return usd;
      }
    }
    return null;
  }
}
