import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { PriceEntry } from '../types/pipeline.types';

// AWS Pricing API — endpoint de filtros por atributo (sem autenticação, sem bulk JSON)
// Docs: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-list-query-api.html
const AWS_PRICING_API = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws';

interface AwsPricingTerm {
  priceDimensions: Record<string, {
    pricePerUnit: { USD: string };
    unit: string;
    description: string;
  }>;
}

interface AwsPricingProduct {
  attributes: {
    instanceType?: string;
    operatingSystem?: string;
    tenancy?: string;
    location?: string;
    servicecode?: string;
    databaseEngine?: string;
    deploymentOption?: string;
    cacheEngine?: string;
  };
}

interface AwsOffersResponse {
  products: Record<string, AwsPricingProduct>;
  terms: {
    OnDemand?: Record<string, Record<string, AwsPricingTerm>>;
  };
}

export interface AwsPricingParams {
  service: 'AmazonEC2' | 'AmazonRDS' | 'AmazonS3' | 'AWSLambda' | 'AmazonElastiCache' | string;
  region: string;
  instanceType?: string;
  operatingSystem?: string;
  databaseEngine?: string;
  deploymentOption?: string;
}

// Mapa de regiões AWS para o nome legível usado nos filtros da API
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
  'me-south-1':     'Middle East (Bahrain)',
  'af-south-1':     'Africa (Cape Town)',
};

// Tamanho máximo de dados a carregar por streaming (5 MB) — evita OOM com arquivos grandes
const MAX_BYTES = 5 * 1024 * 1024;
// Timeout por request
const REQUEST_TIMEOUT_MS = 20_000;

@Injectable()
export class AwsPricingService {
  private readonly logger = new Logger(AwsPricingService.name);

  async getPrice(params: AwsPricingParams, quantityHours: number): Promise<PriceEntry> {
    if (!params.instanceType && params.service === 'AmazonEC2') {
      return { price: null, verified: false, reason: 'instanceType não informado' };
    }

    const regionName = AWS_REGION_NAMES[params.region];
    if (!regionName) {
      return { price: null, verified: false, reason: `Região ${params.region} não mapeada` };
    }

    try {
      const url = `${AWS_PRICING_API}/${params.service}/current/${params.region}/index.json`;

      // Faz streaming parcial: lê até MAX_BYTES e tenta encontrar o produto antes de carregar tudo
      const partial = await this.fetchPartial(url, MAX_BYTES);
      const data = this.parsePartialJson(partial, params, regionName);

      if (!data) {
        // Se o produto não estava nos primeiros 5MB, tenta carregar mais 10MB
        const larger = await this.fetchPartial(url, 15 * 1024 * 1024);
        const data2 = this.parsePartialJson(larger, params, regionName);
        if (!data2) {
          return {
            price: null,
            verified: false,
            reason: `Produto ${params.instanceType ?? params.service} não encontrado nos primeiros 15MB do catálogo`,
          };
        }
        return this.buildEntry(data2, quantityHours);
      }

      return this.buildEntry(data, quantityHours);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro ao consultar AWS Pricing (${params.service}/${params.region}): ${msg}`);
      return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
    }
  }

  // ─── Streaming parcial ────────────────────────────────────────────────────

  private fetchPartial(url: string, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        let body = '';
        let bytes = 0;

        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          bytes += chunk.length;
          if (bytes >= maxBytes) {
            req.destroy();
            resolve(body);
          }
        });
        res.on('end', () => resolve(body));
        res.on('error', reject);
      });

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Timeout ${REQUEST_TIMEOUT_MS}ms — AWS Pricing`));
      });
      req.on('error', (err) => {
        // ECONNRESET é esperado quando destruímos a conexão após maxBytes
        if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve('');
        } else {
          reject(err);
        }
      });
    });
  }

  // ─── Parse do JSON parcial ────────────────────────────────────────────────

  private parsePartialJson(
    raw: string,
    params: AwsPricingParams,
    regionName: string,
  ): { sku: string; hourlyPrice: number } | null {
    if (!raw) return null;

    // Estratégia: extrai pares "SKU": {...} individualmente via regex
    // Evita fazer JSON.parse de um objeto de 100MB incompleto
    const productRegex = /"([A-Z0-9]{16,})":\s*\{"attributes":\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    const candidates: string[] = [];

    while ((match = productRegex.exec(raw)) !== null) {
      const sku = match[1];
      const attrs = match[2];

      if (!attrs.includes(regionName.replace(/[()]/g, '\\$&'))) continue;
      if (attrs.replace(/\\"/g, '').includes(regionName) === false) continue;

      if (params.service === 'AmazonEC2') {
        if (!params.instanceType) continue;
        if (!attrs.includes(`"instanceType":"${params.instanceType}"`)) continue;
        const os = params.operatingSystem ?? 'Linux';
        if (!attrs.includes(`"operatingSystem":"${os}"`)) continue;
        if (!attrs.includes('"tenancy":"Shared"')) continue;
      } else if (params.service === 'AmazonRDS') {
        if (!params.instanceType) continue;
        if (!attrs.includes(`"instanceType":"${params.instanceType}"`)) continue;
        if (params.databaseEngine && !attrs.toLowerCase().includes(params.databaseEngine.toLowerCase())) continue;
      } else if (params.service === 'AmazonElastiCache') {
        if (!params.instanceType) continue;
        if (!attrs.includes(`"instanceType":"${params.instanceType}"`)) continue;
      }

      candidates.push(sku);
      if (candidates.length >= 3) break;
    }

    if (!candidates.length) return null;

    // Agora busca o preço OnDemand para cada candidato
    for (const sku of candidates) {
      const priceRegex = new RegExp(
        `"${sku}":\\s*\\{[^}]*"priceDimensions":\\s*\\{[^}]*"pricePerUnit":\\s*\\{[^}]*"USD":\\s*"([\\d.]+)"`,
        's',
      );
      const priceMatch = priceRegex.exec(raw);
      if (priceMatch) {
        const hourlyPrice = parseFloat(priceMatch[1]);
        if (!isNaN(hourlyPrice) && hourlyPrice > 0) {
          return { sku, hourlyPrice };
        }
      }
    }

    return null;
  }

  private buildEntry(
    data: { sku: string; hourlyPrice: number },
    quantityHours: number,
  ): PriceEntry {
    return {
      price: data.hourlyPrice,
      unit: 'hora',
      estimatedMonthly: Number((data.hourlyPrice * quantityHours).toFixed(2)),
      source: 'AWS Pricing API',
      verified: true,
    };
  }
}
