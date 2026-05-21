import { Injectable, Logger } from '@nestjs/common';
import { AzureMapping, PriceEntry } from '../types/pipeline.types';

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
}

const AZURE_PRICES_API = 'https://prices.azure.com/api/retail/prices';

@Injectable()
export class AzurePricingService {
  private readonly logger = new Logger(AzurePricingService.name);

  async getPrice(mapping: AzureMapping, quantityHours: number): Promise<PriceEntry> {
    const skuName = mapping.skuName ?? mapping.sku;

    if (!skuName || !mapping.region) {
      return {
        price: null,
        verified: false,
        reason: 'Parâmetros insuficientes no mapeamento',
      };
    }

    try {
      const filter = [
        `serviceName eq '${mapping.service}'`,
        `armSkuName eq '${skuName}'`,
        `armRegionName eq '${mapping.region}'`,
        `priceType eq 'Consumption'`,
      ].join(' and ');

      const url = `${AZURE_PRICES_API}?$filter=${encodeURIComponent(filter)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!response.ok) {
        this.logger.warn(`Azure API retornou ${response.status} para SKU ${skuName}`);
        return { price: null, verified: false, reason: `HTTP ${response.status}` };
      }

      const data: AzureApiResponse = await response.json() as AzureApiResponse;
      const item = data.Items?.[0];

      if (!item) {
        return {
          price: null,
          verified: false,
          reason: `SKU ${skuName} não encontrado na região ${mapping.region}`,
        };
      }

      const estimatedMonthly = Number((item.retailPrice * quantityHours).toFixed(2));

      return {
        price: item.retailPrice,
        unit: item.unitOfMeasure,
        estimatedMonthly,
        source: 'Azure Retail Prices API',
        verified: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro ao consultar Azure Pricing: ${msg}`);
      return { price: null, verified: false, reason: `Erro na requisição: ${msg}` };
    }
  }
}