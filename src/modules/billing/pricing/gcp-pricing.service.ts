import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GcpMapping, PriceEntry } from '../types/pipeline.types';

const GCP_BILLING_API = 'https://cloudbilling.googleapis.com/v1/services';

// IDs dos serviços GCP na Billing API
const GCP_SERVICE_IDS: Record<string, string> = {
  'Compute Engine': '6F81-5844-456A',
  'Cloud SQL': '9662-B51E-5089',
  'Cloud Storage': '95FF-2EF5-5EA1',
  'Cloud Run': '152E-C115-5142',
  'BigQuery': '24E6-581D-38E5',
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

// Converte região AWS para região GCP equivalente (retornado pelo mapeamento do Claude)
// O Claude já retorna a região GCP correta; esta função normaliza variações de formato
function normalizeGcpRegion(region: string): string {
  return region.toLowerCase().replace('_', '-');
}

@Injectable()
export class GcpPricingService {
  private readonly logger = new Logger(GcpPricingService.name);

  constructor(private readonly config: ConfigService) {}

  async getPrice(mapping: GcpMapping, quantityHours: number): Promise<PriceEntry> {
    const apiKey = this.config.get<string>('GCP_API_KEY');
    if (!apiKey) {
      return { price: null, verified: false, reason: 'GCP_API_KEY não configurada' };
    }

    const serviceId = GCP_SERVICE_IDS[mapping.service];
    if (!serviceId) {
      return {
        price: null,
        verified: false,
        reason: `Serviço GCP "${mapping.service}" não mapeado para serviceId`,
      };
    }

    const region = mapping.region ? normalizeGcpRegion(mapping.region) : null;
    if (!region) {
      return { price: null, verified: false, reason: 'Região GCP não informada no mapeamento' };
    }

    try {
      const skuIdentifier = mapping.machineType ?? mapping.tier;
      const url = `${GCP_BILLING_API}/${serviceId}/skus?currencyCode=USD&key=${apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) {
        return { price: null, verified: false, reason: `HTTP ${response.status} da GCP Billing API` };
      }

      const data: GcpSkuListResponse = await response.json() as GcpSkuListResponse;
      const sku = this.findSku(data.skus, skuIdentifier, region);

      if (!sku) {
        return {
          price: null,
          verified: false,
          reason: `SKU para ${skuIdentifier ?? mapping.service} não encontrado na região ${region}`,
        };
      }

      const hourlyPrice = this.extractHourlyPrice(sku);
      if (hourlyPrice === null) {
        return { price: null, verified: false, reason: 'Estrutura de preço inesperada na resposta GCP' };
      }

      return {
        price: hourlyPrice,
        unit: 'hora',
        estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
        source: 'GCP Cloud Billing API',
        verified: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro ao consultar GCP Billing API: ${msg}`);
      return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
    }
  }

  private findSku(skus: GcpSku[], identifier: string | undefined, region: string): GcpSku | null {
    if (!identifier) return null;

    // Busca por SKU que mencione o identificador na descrição e cubra a região
    const normalized = identifier.toLowerCase();
    return (
      skus.find(
        (s) =>
          s.description.toLowerCase().includes(normalized) &&
          s.serviceRegions.some((r) => r.toLowerCase() === region),
      ) ?? null
    );
  }

  private extractHourlyPrice(sku: GcpSku): number | null {
    const pricing = sku.pricingInfo?.[0]?.pricingExpression;
    if (!pricing) return null;

    const rate = pricing.tieredRates?.[0];
    if (!rate) return null;

    // GCP retorna preço em unidades + nanos (1 unidade = 1e9 nanos)
    const price = parseInt(rate.unitPrice.units || '0') + rate.unitPrice.nanos / 1e9;
    return price > 0 ? Number(price.toFixed(6)) : null;
  }
}