import { Injectable, Logger } from '@nestjs/common';
import { PriceEntry } from '../types/pipeline.types';

// A AWS Pricing API tem um endpoint paginado mais leve que o index.json completo
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
  };
}

interface AwsOffersResponse {
  products: Record<string, AwsPricingProduct>;
  terms: {
    OnDemand?: Record<string, Record<string, AwsPricingTerm>>;
  };
}

export interface AwsPricingParams {
  service: 'AmazonEC2' | 'AmazonRDS' | 'AmazonS3' | 'AWSLambda' | string;
  region: string;
  instanceType?: string;
  operatingSystem?: string;
  databaseEngine?: string;
  deploymentOption?: string;
}

// Mapa de regiões AWS para o nome legível usado nos filtros da API
const AWS_REGION_NAMES: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-central-1': 'Europe (Frankfurt)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'sa-east-1': 'South America (Sao Paulo)',
};

@Injectable()
export class AwsPricingService {
  private readonly logger = new Logger(AwsPricingService.name);

  async getPrice(params: AwsPricingParams, quantityHours: number): Promise<PriceEntry> {
    if (!params.instanceType && params.service === 'AmazonEC2') {
      return { price: null, verified: false, reason: 'instanceType não informado' };
    }

    try {
      const regionName = AWS_REGION_NAMES[params.region];
      if (!regionName) {
        return { price: null, verified: false, reason: `Região ${params.region} não mapeada` };
      }

      const url = `${AWS_PRICING_API}/${params.service}/current/${params.region}/index.json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (!response.ok) {
        return { price: null, verified: false, reason: `HTTP ${response.status} da AWS Pricing API` };
      }

      const data: AwsOffersResponse = await response.json() as AwsOffersResponse;

      const productSku = this.findProductSku(data, params, regionName);
      if (!productSku) {
        return {
          price: null,
          verified: false,
          reason: `Produto ${params.instanceType ?? params.service} não encontrado nos offers`,
        };
      }

      const onDemandTerms = data.terms?.OnDemand?.[productSku];
      if (!onDemandTerms) {
        return { price: null, verified: false, reason: 'Sem termos OnDemand para este SKU' };
      }

      const hourlyPrice = this.extractHourlyPrice(onDemandTerms);
      if (hourlyPrice === null) {
        return { price: null, verified: false, reason: 'Preço não encontrado nos termos OnDemand' };
      }

      return {
        price: hourlyPrice,
        unit: 'hora',
        estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
        source: 'AWS Pricing API',
        verified: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro ao consultar AWS Pricing: ${msg}`);
      return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
    }
  }

  private findProductSku(
    data: AwsOffersResponse,
    params: AwsPricingParams,
    regionName: string,
  ): string | null {
    for (const [sku, product] of Object.entries(data.products)) {
      const attr = product.attributes;

      if (attr.location !== regionName) continue;

      if (params.service === 'AmazonEC2') {
        if (
          attr.instanceType === params.instanceType &&
          attr.operatingSystem === (params.operatingSystem ?? 'Linux') &&
          attr.tenancy === 'Shared'
        ) {
          return sku;
        }
      } else if (params.service === 'AmazonRDS') {
        if (
          attr.instanceType === params.instanceType &&
          (params.databaseEngine ? attr.servicecode?.toLowerCase().includes(params.databaseEngine.toLowerCase()) : true)
        ) {
          return sku;
        }
      } else {
        // Fallback genérico: primeiro produto da região
        return sku;
      }
    }
    return null;
  }

  private extractHourlyPrice(
    terms: Record<string, AwsPricingTerm>,
  ): number | null {
    for (const term of Object.values(terms)) {
      for (const dim of Object.values(term.priceDimensions)) {
        const usd = parseFloat(dim.pricePerUnit.USD);
        if (!isNaN(usd) && usd > 0) return usd;
      }
    }
    return null;
  }
}