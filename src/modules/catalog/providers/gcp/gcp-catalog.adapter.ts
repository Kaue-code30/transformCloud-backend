import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import type { CatalogResourceKind, CatalogSnapshot } from '../../catalog.types';

interface GcpMoney { currencyCode?: string; units?: string; nanos?: number }
interface GcpPricingInfo {
  effectiveTime?: string;
  pricingExpression?: {
    usageUnit?: string;
    usageUnitDescription?: string;
    baseUnit?: string;
    baseUnitConversionFactor?: number;
    tieredRates?: Array<{ startUsageAmount?: number | string; unitPrice?: GcpMoney }>;
  };
}
interface GcpSku {
  name: string;
  skuId: string;
  description: string;
  serviceRegions?: string[];
  category?: { serviceDisplayName?: string; resourceFamily?: string; resourceGroup?: string; usageType?: string };
  pricingInfo?: GcpPricingInfo[];
  [key: string]: unknown;
}
interface GcpService { name: string; serviceId: string; displayName: string }

export interface GcpCatalogSyncOptions {
  apiKey: string;
  service: string;
  region: string;
  match?: string;
  maxSkus?: number;
}

@Injectable()
export class GcpCatalogAdapter {
  private readonly baseUrl = 'https://cloudbilling.googleapis.com/v1';

  async download(options: GcpCatalogSyncOptions): Promise<CatalogSnapshot> {
    if (!options.apiKey || !options.service || !options.region) {
      throw new BadRequestException('apiKey, service e region são obrigatórios');
    }
    const service = await this.resolveService(options.service, options.apiKey);
    const skus = await this.listSkus(service.name, options.apiKey, options.maxSkus ?? 500);
    return this.toSnapshot(service, skus, options);
  }

  toSnapshot(service: GcpService, skus: GcpSku[], options: Omit<GcpCatalogSyncOptions, 'apiKey'>): CatalogSnapshot {
    const services = new Map<string, CatalogSnapshot['services'][number]>();
    const offerings: CatalogSnapshot['offerings'] = [];
    const meters: CatalogSnapshot['meters'] = [];
    const offeringMeters: CatalogSnapshot['offeringMeters'] = [];
    const needle = options.match?.toLowerCase();

    for (const sku of skus) {
      if (offerings.length >= (options.maxSkus ?? 500)) break;
      if (needle && !JSON.stringify(sku).toLowerCase().includes(needle)) continue;
      if (!supportsRegion(sku.serviceRegions, options.region)) continue;
      const resourceKind = resourceKindFor(service.displayName, sku);
      if (!resourceKind) continue;
      const pricing = latestPricing(sku.pricingInfo);
      const expression = pricing?.pricingExpression;
      const tiers = (expression?.tieredRates ?? []).map((tier) => ({
        startQuantity: Number(tier.startUsageAmount ?? 0),
        unitPrice: money(tier.unitPrice),
      })).filter((tier) => Number.isFinite(tier.unitPrice));
      if (!pricing?.effectiveTime || !expression?.usageUnit || !tiers.length) continue;

      const serviceNativeCode = `${service.serviceId}:${resourceKind}`;
      services.set(serviceNativeCode, { nativeCode: serviceNativeCode, name: service.displayName, resourceKind });
      const offeringKey = `GCP_CATALOG:${sku.skuId}:${options.region}`;
      const meterKey = `GCP_CATALOG:METER:${sku.skuId}:${options.region}:${pricing.effectiveTime}`;
      offerings.push({
        sourceKey: offeringKey,
        serviceNativeCode,
        nativeProductId: sku.skuId,
        nativeSkuName: sku.description,
        displayName: sku.description,
        region: options.region,
        purchaseOption: 'ON_DEMAND',
        engine: resourceKind === 'MANAGED_POSTGRES' ? 'PostgreSQL' : resourceKind === 'MANAGED_MYSQL' ? 'MySQL' : undefined,
        attributes: { ...sku.category, usageType: sku.category?.usageType, serviceRegions: sku.serviceRegions ?? [] },
        rawSource: sku,
      });
      const currency = pricingCurrency(expression.tieredRates) ?? 'USD';
      meters.push({
        sourceKey: meterKey,
        serviceNativeCode,
        nativeSkuId: sku.skuId,
        nativeMeterId: sku.name,
        name: expression.usageUnitDescription ?? sku.description,
        region: options.region,
        pricingUnit: expression.usageUnit,
        unitMultiplier: 1,
        currency,
        priceType: 'ON_DEMAND',
        effectiveFrom: pricing.effectiveTime,
        attributes: {
          catalogSource: 'GCP_CLOUD_BILLING_CATALOG_API',
          baseUnit: expression.baseUnit ?? '',
          baseUnitConversionFactor: expression.baseUnitConversionFactor ?? 1,
        },
        rawSource: pricing as unknown as Record<string, unknown>,
        tiers,
      });
      offeringMeters.push({ offeringSourceKey: offeringKey, meterSourceKey: meterKey, quantity: 1 });
    }
    if (!offerings.length) throw new BadRequestException('Nenhum SKU GCP compatível encontrado');
    return {
      provider: 'GCP', source: 'GCP_CLOUD_BILLING_CATALOG_API',
      version: newestEffective(meters), mode: 'PARTIAL',
      services: [...services.values()], offerings, meters, offeringMeters,
    };
  }

  private async resolveService(query: string, apiKey: string): Promise<GcpService> {
    let pageToken = '';
    const normalized = normalizeServiceName(query);
    do {
      const url = new URL(`${this.baseUrl}/services`);
      url.searchParams.set('pageSize', '5000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await this.fetchJson<{ services?: GcpService[]; nextPageToken?: string }>(url, apiKey);
      const found = data.services?.find((item) =>
        item.serviceId === query ||
        item.name === query ||
        item.displayName.toLowerCase() === normalized,
      );
      if (found) return found;
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
    throw new BadRequestException(`Serviço GCP não encontrado: ${query}`);
  }

  private async listSkus(serviceName: string, apiKey: string, max: number): Promise<GcpSku[]> {
    const result: GcpSku[] = [];
    let pageToken = '';
    do {
      const url = new URL(`${this.baseUrl}/${serviceName}/skus`);
      url.searchParams.set('pageSize', String(Math.min(5000, max)));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await this.fetchJson<{ skus?: GcpSku[]; nextPageToken?: string }>(url, apiKey);
      result.push(...(data.skus ?? []));
      pageToken = data.nextPageToken ?? '';
    } while (pageToken && result.length < max);
    return result.slice(0, max);
  }

  private async fetchJson<T>(url: URL, apiKey: string): Promise<T> {
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string; status?: string } } | null;
      const detail = body?.error?.message ?? body?.error?.status ?? 'sem detalhes';
      throw new BadGatewayException(`GCP Catalog retornou HTTP ${response.status}: ${detail}`);
    }
    return response.json() as Promise<T>;
  }
}

function normalizeServiceName(value: string): string {
  const normalized = value.toLowerCase().trim();
  const aliases: Record<string, string> = {
    'cloud functions': 'cloud run functions',
  };
  return aliases[normalized] ?? normalized;
}

function resourceKindFor(service: string, sku: GcpSku): CatalogResourceKind | null {
  const text = `${service} ${sku.description} ${sku.category?.resourceFamily ?? ''}`.toLowerCase();
  if (text.includes('network') && (text.includes('egress') || text.includes('data transfer') || text.includes('internet'))) return 'DATA_TRANSFER';
  if (text.includes('cloud sql') && text.includes('postgres')) return 'MANAGED_POSTGRES';
  if (text.includes('cloud sql') && text.includes('mysql')) return 'MANAGED_MYSQL';
  if (text.includes('cloud storage') || (text.includes('storage') && text.includes('byte'))) return 'OBJECT_STORAGE';
  if (text.includes('cloud function') || text.includes('functions')) return 'SERVERLESS_FUNCTION';
  if (text.includes('cloud logging') || text.includes('log ingestion')) return 'OBSERVABILITY_LOGS';
  if (text.includes('compute engine') && (text.includes('core') || text.includes('ram') || text.includes('instance'))) return 'COMPUTE_VM';
  return null;
}

function supportsRegion(regions: string[] | undefined, region: string): boolean {
  return !regions?.length || regions.includes(region) || regions.includes('global');
}
function latestPricing(items: GcpPricingInfo[] | undefined): GcpPricingInfo | undefined {
  return [...(items ?? [])].sort((a, b) => (b.effectiveTime ?? '').localeCompare(a.effectiveTime ?? ''))[0];
}
function money(value: GcpMoney | undefined): number {
  return Number(value?.units ?? 0) + Number(value?.nanos ?? 0) / 1_000_000_000;
}
function pricingCurrency(rates: GcpPricingInfo['pricingExpression'] extends infer _ ? Array<{ unitPrice?: GcpMoney }> | undefined : never): string | undefined {
  return rates?.map((rate) => rate.unitPrice?.currencyCode).find(Boolean);
}
function newestEffective(meters: CatalogSnapshot['meters']): string | undefined {
  return meters.map((meter) => meter.effectiveFrom).sort().at(-1);
}
