import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import type { CatalogResourceKind, CatalogSnapshot } from '../../catalog.types';

interface AwsProduct {
  sku: string;
  productFamily?: string;
  attributes: Record<string, string | undefined>;
}

interface AwsPriceDimension {
  rateCode: string;
  description?: string;
  beginRange: string;
  endRange: string;
  unit: string;
  pricePerUnit: Record<string, string | undefined>;
}

interface AwsTerm {
  effectiveDate: string;
  priceDimensions: Record<string, AwsPriceDimension>;
  termAttributes?: Record<string, string>;
}

interface AwsOfferFile {
  publicationDate?: string;
  version?: string;
  products: Record<string, AwsProduct>;
  terms?: { OnDemand?: Record<string, Record<string, AwsTerm>> };
}

export interface AwsCatalogSyncOptions {
  serviceCode: string;
  region: string;
  match?: string;
  maxProducts?: number;
}

@Injectable()
export class AwsCatalogAdapter {
  async download(options: AwsCatalogSyncOptions): Promise<CatalogSnapshot> {
    if (!options.serviceCode || !options.region) {
      throw new BadRequestException('serviceCode e region são obrigatórios');
    }
    const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${encodeURIComponent(options.serviceCode)}/current/${encodeURIComponent(options.region)}/index.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      throw new BadGatewayException(`AWS Price List retornou HTTP ${response.status}`);
    }
    const payload = await response.json() as AwsOfferFile;
    return this.toSnapshot(payload, options);
  }

  toSnapshot(payload: AwsOfferFile, options: AwsCatalogSyncOptions): CatalogSnapshot {
    const services = new Map<string, CatalogSnapshot['services'][number]>();
    const offerings: CatalogSnapshot['offerings'] = [];
    const meters: CatalogSnapshot['meters'] = [];
    const offeringMeters: CatalogSnapshot['offeringMeters'] = [];
    const needle = options.match?.toLowerCase();
    const limit = options.maxProducts ?? 500;

    for (const product of Object.values(payload.products)) {
      if (offerings.length >= limit) break;
      const searchable = JSON.stringify(product).toLowerCase();
      if (needle && !searchable.includes(needle)) continue;
      const resourceKind = resourceKindFor(options.serviceCode, product);
      if (!resourceKind) continue;
      const terms = Object.values(payload.terms?.OnDemand?.[product.sku] ?? {}).flatMap(
        (term) => Object.values(term.priceDimensions).map((dimension) => ({ term, dimension })),
      );
      const pricedTerms = terms.filter(({ dimension }) => priceOf(dimension) != null);
      if (!pricedTerms.length) continue;

      const serviceNativeCode = normalizedServiceCode(options.serviceCode, resourceKind, product);
      const serviceName = product.attributes.servicename ?? options.serviceCode;
      services.set(serviceNativeCode, { nativeCode: serviceNativeCode, name: serviceName, resourceKind });
      const nativeSkuName = nativeName(product);
      const offeringKey = `AWS_PRICE_LIST:${options.serviceCode}:${options.region}:${product.sku}`;
      offerings.push({
        sourceKey: offeringKey,
        serviceNativeCode,
        nativeProductId: product.sku,
        nativeSkuName,
        displayName: product.attributes.productFamily ?? `${serviceName} ${nativeSkuName}`,
        region: options.region,
        purchaseOption: 'ON_DEMAND',
        operatingSystem: product.attributes.operatingSystem,
        architecture: normalizeArchitecture(product.attributes.processorArchitecture),
        family: product.attributes.instanceFamily,
        engine: product.attributes.databaseEngine,
        vcpu: numberFrom(product.attributes.vcpu) ?? undefined,
        memoryGiB: memoryGiB(product.attributes.memory),
        highAvailability: highAvailability(product.attributes.deploymentOption),
        attributes: scalarAttributes(product.attributes),
        rawSource: product as unknown as Record<string, unknown>,
      });

      for (const { term, dimension } of pricedTerms) {
        const currency = Object.keys(dimension.pricePerUnit).find(
          (key) => dimension.pricePerUnit[key] != null,
        ) ?? 'USD';
        const meterKey = `AWS_PRICE_LIST:METER:${dimension.rateCode}`;
        meters.push({
          sourceKey: meterKey,
          serviceNativeCode,
          nativeSkuId: product.sku,
          nativeMeterId: dimension.rateCode,
          name: dimension.description ?? dimension.rateCode,
          region: options.region,
          pricingUnit: dimension.unit,
          currency,
          priceType: 'ON_DEMAND',
          effectiveFrom: term.effectiveDate,
          attributes: {
            ...scalarAttributes(term.termAttributes ?? {}),
            catalogSource: 'AWS_PRICE_LIST_BULK_API',
          },
          rawSource: dimension as unknown as Record<string, unknown>,
          tiers: [{
            startQuantity: numberFrom(dimension.beginRange) ?? 0,
            ...(dimension.endRange !== 'Inf' ? { endQuantity: numberFrom(dimension.endRange) ?? undefined } : {}),
            unitPrice: priceOf(dimension)!,
          }],
        });
        offeringMeters.push({ offeringSourceKey: offeringKey, meterSourceKey: meterKey, quantity: 1 });
      }
    }

    if (!offerings.length) {
      throw new BadRequestException('Nenhuma oferta compatível encontrada no arquivo oficial da AWS');
    }
    return {
      provider: 'AWS',
      source: 'AWS_PRICE_LIST_BULK_API',
      version: payload.version ?? payload.publicationDate,
      mode: 'PARTIAL',
      services: [...services.values()],
      offerings,
      meters,
      offeringMeters,
    };
  }
}

function resourceKindFor(serviceCode: string, product: AwsProduct): CatalogResourceKind | null {
  const family = (product.productFamily ?? '').toLowerCase();
  const engine = (product.attributes.databaseEngine ?? '').toLowerCase();
  if (serviceCode === 'AmazonEC2' && product.attributes.instanceType && family.includes('compute')) return 'COMPUTE_VM';
  if (serviceCode === 'AmazonRDS' && engine.includes('postgres')) return 'MANAGED_POSTGRES';
  if (serviceCode === 'AmazonRDS' && engine.includes('mysql')) return 'MANAGED_MYSQL';
  if (serviceCode === 'AmazonS3' && family.includes('storage')) return 'OBJECT_STORAGE';
  if (serviceCode === 'AWSLambda') return 'SERVERLESS_FUNCTION';
  if (serviceCode === 'AmazonCloudWatch') return 'OBSERVABILITY_LOGS';
  if (serviceCode === 'AWSDataTransfer' || family.includes('data transfer')) return 'DATA_TRANSFER';
  return null;
}

function normalizedServiceCode(code: string, kind: CatalogResourceKind, product: AwsProduct): string {
  const engine = product.attributes.databaseEngine?.replace(/[^a-z0-9]/gi, '');
  return engine ? `${code}:${engine}:${kind}` : `${code}:${kind}`;
}

function nativeName(product: AwsProduct): string {
  return product.attributes.instanceType ?? product.attributes.databaseInstanceClass ??
    product.attributes.storageClass ?? product.attributes.group ?? product.attributes.usagetype ?? product.sku;
}

function priceOf(dimension: AwsPriceDimension): number | null {
  for (const value of Object.values(dimension.pricePerUnit)) {
    const parsed = numberFrom(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function numberFrom(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function memoryGiB(value: string | undefined): number | undefined {
  return numberFrom(value?.match(/[\d,.]+/)?.[0]) ?? undefined;
}

function normalizeArchitecture(value: string | undefined): string | undefined {
  const lower = value?.toLowerCase() ?? '';
  if (lower.includes('arm')) return 'arm64';
  if (lower.includes('64-bit') || lower.includes('x86')) return 'x86_64';
  return undefined;
}

function highAvailability(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  return /multi-az/i.test(value);
}

function scalarAttributes(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => Boolean(entry[1])));
}
