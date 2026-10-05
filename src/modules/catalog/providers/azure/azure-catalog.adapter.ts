import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import type {
  CatalogResourceKind,
  CatalogSnapshot,
} from '../../catalog.types';

export interface AzureRetailPriceItem {
  currencyCode?: string;
  tierMinimumUnits?: number;
  retailPrice?: number;
  unitPrice?: number;
  armRegionName?: string;
  location?: string;
  effectiveStartDate?: string;
  meterId?: string;
  meterName?: string;
  productId?: string;
  skuId?: string;
  productName?: string;
  skuName?: string;
  serviceName?: string;
  serviceId?: string;
  serviceFamily?: string;
  unitOfMeasure?: string;
  type?: string;
  priceType?: string;
  isPrimaryMeterRegion?: boolean;
  armSkuName?: string;
  [key: string]: unknown;
}

interface AzureRetailPricesResponse {
  Items?: AzureRetailPriceItem[];
  NextPageLink?: string;
  items?: AzureRetailPriceItem[];
  nextPageLink?: string;
}

export interface AzureCatalogSyncOptions {
  service: string;
  region: string;
  currency?: string;
  match?: string;
  productName?: string;
  meterName?: string;
  skuName?: string;
  armSkuName?: string;
  maxItems?: number;
  resourceKind?: CatalogResourceKind;
  offeringName?: string;
  vcpu?: number;
  memoryGiB?: number;
  operatingSystem?: string;
  architecture?: string;
  engine?: string;
}

@Injectable()
export class AzureCatalogAdapter {
  private readonly baseUrl = 'https://prices.azure.com/api/retail/prices';

  async download(options: AzureCatalogSyncOptions): Promise<CatalogSnapshot> {
    if (!options.service || !options.region) {
      throw new BadRequestException('service e region são obrigatórios');
    }
    const items = await this.listItems(options);
    return this.toSnapshot(items, options);
  }

  toSnapshot(
    items: AzureRetailPriceItem[],
    options: AzureCatalogSyncOptions,
  ): CatalogSnapshot {
    const services = new Map<
      string,
      CatalogSnapshot['services'][number]
    >();
    const offerings: CatalogSnapshot['offerings'] = [];
    const meters: CatalogSnapshot['meters'] = [];
    const offeringMeters: CatalogSnapshot['offeringMeters'] = [];
    const needle = options.match?.toLowerCase();
    const maxItems = options.maxItems ?? 500;
    const grouped = new Map<string, AzureRetailPriceItem[]>();

    for (const item of items) {
      if (needle && !JSON.stringify(item).toLowerCase().includes(needle)) continue;
      if (item.armRegionName && item.armRegionName !== options.region) continue;
      if (item.serviceName && item.serviceName !== options.service) continue;
      if (options.productName && item.productName !== options.productName) continue;
      if (options.meterName && item.meterName !== options.meterName) continue;
      if (options.skuName && item.skuName !== options.skuName) continue;
      if (options.armSkuName && item.armSkuName !== options.armSkuName) continue;
      if (!isConsumption(item) || isDiscountedCapacity(item)) continue;
      const detectedOperatingSystem = inferOperatingSystem(item.productName);
      if (
        options.operatingSystem &&
        detectedOperatingSystem &&
        detectedOperatingSystem.toLowerCase() !==
          options.operatingSystem.toLowerCase()
      ) {
        continue;
      }
      const price = finiteNumber(item.retailPrice ?? item.unitPrice);
      if (price == null || price < 0 || !item.effectiveStartDate) continue;
      const resourceKind = options.resourceKind ?? resourceKindFor(item);
      if (!resourceKind) continue;
      const meterId = item.meterId ?? item.skuId;
      const skuId = item.skuId ?? item.productId ?? meterId;
      if (!meterId || !skuId || !item.unitOfMeasure) continue;
      const key = [resourceKind, skuId, meterId, item.effectiveStartDate].join(':');
      const group = grouped.get(key) ?? [];
      group.push(item);
      grouped.set(key, group);
    }

    for (const [groupKey, group] of grouped) {
      if (offerings.length >= maxItems) break;
      const item = group[0];
      const resourceKind = options.resourceKind ?? resourceKindFor(item);
      if (!resourceKind) continue;
      const serviceNativeCode = `${item.serviceId ?? item.serviceName ?? options.service}:${resourceKind}`;
      services.set(serviceNativeCode, {
        nativeCode: serviceNativeCode,
        name: item.serviceName ?? options.service,
        resourceKind,
      });

      const meterId = item.meterId ?? item.skuId!;
      const skuId = item.skuId ?? item.productId ?? meterId;
      const nativeSkuName =
        options.offeringName ??
        item.armSkuName ??
        item.skuName ??
        item.meterName ??
        skuId;
      const offeringKey = `AZURE_RETAIL:${options.region}:${groupKey}`;
      const meterKey = `AZURE_RETAIL:METER:${options.region}:${groupKey}`;
      const unit = normalizeAzureUnit(item.unitOfMeasure!);
      const tiers = group
        .map((tier) => ({
          startQuantity: finiteNumber(tier.tierMinimumUnits) ?? 0,
          unitPrice: finiteNumber(tier.retailPrice ?? tier.unitPrice)!,
        }))
        .sort((a, b) => a.startQuantity - b.startQuantity);

      offerings.push({
        sourceKey: offeringKey,
        serviceNativeCode,
        nativeProductId: skuId,
        nativeSkuName,
        displayName: `${item.productName ?? item.serviceName ?? options.service} — ${item.meterName ?? nativeSkuName}`,
        region: options.region,
        purchaseOption: 'ON_DEMAND',
        operatingSystem:
          options.operatingSystem ?? inferOperatingSystem(item.productName),
        architecture: options.architecture,
        engine: options.engine ?? inferEngine(resourceKind),
        vcpu: options.vcpu ?? inferAzureVcpu(item.armSkuName),
        memoryGiB: options.memoryGiB,
        attributes: {
          serviceFamily: item.serviceFamily ?? '',
          skuName: item.skuName ?? '',
          armSkuName: item.armSkuName ?? '',
          meterName: item.meterName ?? '',
          location: item.location ?? '',
          isPrimaryMeterRegion: item.isPrimaryMeterRegion ?? true,
        },
        rawSource: item,
      });
      meters.push({
        sourceKey: meterKey,
        serviceNativeCode,
        nativeSkuId: skuId,
        nativeMeterId: meterId,
        name: item.meterName ?? meterId,
        region: options.region,
        pricingUnit: unit.unit,
        unitMultiplier: unit.multiplier,
        currency: item.currencyCode ?? options.currency ?? 'USD',
        priceType: 'ON_DEMAND',
        effectiveFrom: item.effectiveStartDate!,
        attributes: {
          catalogSource: 'AZURE_RETAIL_PRICES_API',
          originalUnitOfMeasure: item.unitOfMeasure,
          retailPrice: item.retailPrice ?? item.unitPrice ?? 0,
        },
        rawSource: item,
        tiers,
      });
      offeringMeters.push({
        offeringSourceKey: offeringKey,
        meterSourceKey: meterKey,
        quantity: 1,
      });
    }

    if (!offerings.length) {
      throw new BadRequestException(
        'Nenhum preço Azure compatível encontrado para os filtros informados',
      );
    }
    return {
      provider: 'AZURE',
      source: 'AZURE_RETAIL_PRICES_API',
      version: newestEffective(meters),
      mode: 'PARTIAL',
      services: [...services.values()],
      offerings,
      meters,
      offeringMeters,
    };
  }

  private async listItems(
    options: AzureCatalogSyncOptions,
  ): Promise<AzureRetailPriceItem[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('currencyCode', `'${options.currency ?? 'USD'}'`);
    const filters = [
      `armRegionName eq '${escapeOdata(options.region)}'`,
      `serviceName eq '${escapeOdata(options.service)}'`,
      "priceType eq 'Consumption'",
    ];
    const armSkuName =
      options.armSkuName ??
      (options.match?.startsWith('Standard_') ? options.match : undefined);
    if (armSkuName) {
      filters.push(`armSkuName eq '${escapeOdata(armSkuName)}'`);
    }
    if (options.productName)
      filters.push(`productName eq '${escapeOdata(options.productName)}'`);
    if (options.meterName)
      filters.push(`meterName eq '${escapeOdata(options.meterName)}'`);
    if (options.skuName)
      filters.push(`skuName eq '${escapeOdata(options.skuName)}'`);
    url.searchParams.set('$filter', filters.join(' and '));

    const result: AzureRetailPriceItem[] = [];
    const scanLimit = 50_000;
    let nextUrl: URL | null = url;
    while (nextUrl && result.length < scanLimit) {
      const data = await this.fetchJson<AzureRetailPricesResponse>(nextUrl);
      result.push(...(data.Items ?? data.items ?? []));
      const next = data.NextPageLink ?? data.nextPageLink;
      nextUrl = next ? new URL(next) : null;
    }
    return result;
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      const detail = await response.text().catch(() => 'sem detalhes');
      throw new BadGatewayException(
        `Azure Retail Prices retornou HTTP ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
    return response.json() as Promise<T>;
  }
}

function isConsumption(item: AzureRetailPriceItem): boolean {
  const type = (item.type ?? item.priceType ?? 'Consumption').toLowerCase();
  return type === 'consumption';
}

function isDiscountedCapacity(item: AzureRetailPriceItem): boolean {
  return /\bspot\b|low priority/i.test(
    `${item.skuName ?? ''} ${item.meterName ?? ''}`,
  );
}

function resourceKindFor(
  item: AzureRetailPriceItem,
): CatalogResourceKind | null {
  const text = [
    item.serviceName,
    item.serviceFamily,
    item.productName,
    item.skuName,
    item.meterName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    text.includes('bandwidth') ||
    text.includes('data transfer') ||
    text.includes('data transferred')
  )
    return 'DATA_TRANSFER';
  if (text.includes('postgresql')) return 'MANAGED_POSTGRES';
  if (text.includes('mysql')) return 'MANAGED_MYSQL';
  if (text.includes('function')) return 'SERVERLESS_FUNCTION';
  if (
    text.includes('log analytics') ||
    text.includes('azure monitor') ||
    text.includes('logs ingestion')
  )
    return 'OBSERVABILITY_LOGS';
  if (
    text.includes('blob') ||
    text.includes('object storage') ||
    (text.includes('storage') && text.includes('data stored'))
  )
    return 'OBJECT_STORAGE';
  if (
    item.serviceName === 'Virtual Machines' ||
    text.includes('virtual machines')
  )
    return 'COMPUTE_VM';
  return null;
}

function normalizeAzureUnit(value: string): {
  unit: string;
  multiplier: number;
} {
  const lower = value.toLowerCase();
  const multiplier = quantityPrefix(value);
  if (lower.includes('gb') && lower.includes('second')) {
    return { unit: 'GB-Second', multiplier };
  }
  if (lower.includes('gb') && (lower.includes('month') || lower.includes('/mo'))) {
    return { unit: 'GB-Mo', multiplier };
  }
  if (lower.includes('gb')) return { unit: 'GB', multiplier };
  if (lower.includes('hour')) return { unit: 'Hrs', multiplier };
  if (lower.includes('request') || lower.includes('operation')) {
    return { unit: 'Requests', multiplier };
  }
  return { unit: value, multiplier };
}

function quantityPrefix(value: string): number {
  const match = value.trim().match(/^([\d,.]+)\s*([kKmM])?/);
  if (!match) return 1;
  const number = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number) || number <= 0) return 1;
  const suffix = match[2]?.toLowerCase();
  return number * (suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1);
}

function inferAzureVcpu(value: string | undefined): number | undefined {
  const parsed = Number(value?.match(/^Standard_[A-Za-z]+(\d+)/)?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function inferOperatingSystem(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/windows/i.test(value)) return 'Windows';
  if (/linux|ubuntu|red hat|suse/i.test(value)) return 'Linux';
  return undefined;
}

function inferEngine(
  kind: CatalogResourceKind,
): string | undefined {
  if (kind === 'MANAGED_POSTGRES') return 'PostgreSQL';
  if (kind === 'MANAGED_MYSQL') return 'MySQL';
  return undefined;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeOdata(value: string): string {
  return value.replace(/'/g, "''");
}

function newestEffective(meters: CatalogSnapshot['meters']): string | undefined {
  return meters.map((meter) => meter.effectiveFrom).sort().at(-1);
}
