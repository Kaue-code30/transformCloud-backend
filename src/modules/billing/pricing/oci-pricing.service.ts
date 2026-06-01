import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { OciMapping, PriceEntry } from '../types/pipeline.types';
import { readCatalog } from '../catalog/catalog-sync.service';

const OCI_PRICING_API = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/';
// Flex shapes cobram OCPU e memória por separado — precisamos dos dois SKUs
const OCPU_KEYWORDS = ['ocpu', 'vcpu', 'cpu'];
const MEM_KEYWORDS  = ['memory', 'ram', 'gb memory'];

interface OciProduct {
  partNumber: string;
  displayName: string;
  metricName: string;
  serviceCategory: string;
  currencyCodeLocalizations: Array<{
    currencyCode: string;
    prices: Array<{ model: string; value: number }>;
  }>;
}

interface OciApiResponse {
  items: OciProduct[];
  hasMore?: boolean;
  count?: number;
}

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('OCI API timeout')); });
    req.on('error', reject);
  });
}

function usdPayg(product: OciProduct): number | null {
  const usd = product.currencyCodeLocalizations.find((c) => c.currencyCode === 'USD');
  if (!usd) return null;
  const payg = usd.prices.find((p) => p.model === 'PAY_AS_YOU_GO');
  return payg?.value ?? null;
}

@Injectable()
export class OciPricingService {
  private readonly logger = new Logger(OciPricingService.name);

  // Catálogo completo carregado uma vez por processo
  private catalog: OciProduct[] | null = null;
  private catalogLoading: Promise<OciProduct[]> | null = null;

  async getPrice(mapping: OciMapping, quantityHours: number): Promise<PriceEntry> {
    const shape = mapping.shape;
    if (!shape) {
      return { price: null, verified: false, reason: 'OCI shape não informado' };
    }

    try {
      const catalog = await this.loadCatalog();

      const isFlexShape = shape.includes('Flex') || shape.includes('flex');

      if (isFlexShape) {
        return this.priceFlexShape(catalog, shape, mapping, quantityHours);
      } else {
        return this.priceFixedShape(catalog, shape, quantityHours);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`OCI pricing error para ${shape}: ${msg}`);
      return { price: null, verified: false, reason: `Erro OCI: ${msg}` };
    }
  }

  // ─── Flex shapes: (ocpu_price × ocpu) + (mem_price × memGb) ─────────────

  private priceFlexShape(
    catalog: OciProduct[],
    shape: string,
    mapping: OciMapping,
    quantityHours: number,
  ): PriceEntry {
    // Extrai a família da shape: "VM.Standard.E4.Flex" → "E4", "VM.Standard.A1.Flex" → "A1"
    const family = this.extractShapeFamily(shape);
    if (!family) {
      return { price: null, verified: false, reason: `Família de shape não reconhecida: ${shape}` };
    }

    const ocpuProduct = this.findFlexProduct(catalog, family, 'ocpu');
    const memProduct  = this.findFlexProduct(catalog, family, 'memory');

    if (!ocpuProduct) {
      this.logger.warn(`OCI: SKU de OCPU não encontrado para família ${family}`);
      return { price: null, verified: false, reason: `SKU OCPU não encontrado para ${family}` };
    }
    if (!memProduct) {
      this.logger.warn(`OCI: SKU de memória não encontrado para família ${family}`);
      return { price: null, verified: false, reason: `SKU memória não encontrado para ${family}` };
    }

    const ocpuUnitPrice = usdPayg(ocpuProduct);
    const memUnitPrice  = usdPayg(memProduct);

    if (ocpuUnitPrice === null || memUnitPrice === null) {
      return { price: null, verified: false, reason: 'Preço USD não disponível nos SKUs OCI' };
    }

    const ocpu  = mapping.ocpu    ?? 1;
    const memGb = mapping.memoryGb ?? 8;
    const hourlyPrice = (ocpuUnitPrice * ocpu) + (memUnitPrice * memGb);

    this.logger.debug(
      `OCI Flex ${shape}: ocpu=${ocpu}×$${ocpuUnitPrice} + mem=${memGb}GB×$${memUnitPrice} = $${hourlyPrice.toFixed(4)}/h`,
    );

    return {
      price: Number(hourlyPrice.toFixed(6)),
      unit: 'hora',
      estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
      source: 'OCI Pricing API',
      verified: true,
    };
  }

  // ─── Fixed shapes: MySQL, Redis Cache — um único SKU por hora ────────────

  private priceFixedShape(
    catalog: OciProduct[],
    shape: string,
    quantityHours: number,
  ): PriceEntry {
    // shape ex: "MySQL.VM.Standard.E3.2.16GB"
    // Busca por serviceCategory + especificação (ex: "2 OCPU" / "16 GB")
    const product = this.findFixedProduct(catalog, shape);

    if (!product) {
      this.logger.warn(`OCI: produto não encontrado para shape ${shape}`);
      return { price: null, verified: false, reason: `Shape ${shape} não encontrado no catálogo OCI` };
    }

    const hourlyPrice = usdPayg(product);
    if (hourlyPrice === null) {
      return { price: null, verified: false, reason: 'Preço USD não disponível' };
    }

    this.logger.debug(`OCI Fixed ${shape}: "${product.displayName}" $${hourlyPrice}/h`);

    return {
      price: hourlyPrice,
      unit: 'hora',
      estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
      source: 'OCI Pricing API',
      verified: true,
    };
  }

  // ─── Busca no catálogo ────────────────────────────────────────────────────

  private extractShapeFamily(shape: string): string | null {
    // VM.Standard.E4.Flex → E4
    // VM.Standard.A1.Flex → A1
    // VM.Optimized3.Flex  → Optimized3
    // VM.Standard3.Flex   → Standard3
    const m = shape.match(/(?:Standard|Optimized)\.?([A-Z0-9]+)\.Flex/i);
    return m ? m[1].toUpperCase() : null;
  }

  private findFlexProduct(
    catalog: OciProduct[],
    family: string,
    type: 'ocpu' | 'memory',
  ): OciProduct | null {
    const familyLower = family.toLowerCase();
    const keywords = type === 'ocpu' ? OCPU_KEYWORDS : MEM_KEYWORDS;

    return catalog.find((p) => {
      const name = p.displayName.toLowerCase();
      const metric = p.metricName.toLowerCase();
      // Deve mencionar a família
      if (!name.includes(familyLower) && !name.includes(`e${family.slice(-1)}`)) return false;
      // Deve mencionar OCPU ou Memory conforme o tipo
      const combined = `${name} ${metric}`;
      return keywords.some((kw) => combined.includes(kw));
    }) ?? null;
  }

  private findFixedProduct(catalog: OciProduct[], shape: string): OciProduct | null {
    // shape: "MySQL.VM.Standard.E3.2.16GB"
    // Extrai o número de OCPUs e GB de memória do shape name
    const m = shape.match(/\.(\d+)\.(\d+)GB$/i);
    if (!m) return null;

    const ocpu = m[1];   // "2"
    const mem  = m[2];   // "16"

    // Detecta o serviço (MySQL vs Redis)
    const isMySQL = shape.toLowerCase().includes('mysql');
    const isRedis = shape.toLowerCase().includes('redis') || shape.toLowerCase().includes('cache');

    return catalog.find((p) => {
      const name = p.displayName.toLowerCase();
      const cat  = p.serviceCategory.toLowerCase();

      if (isMySQL && !cat.includes('mysql') && !name.includes('mysql')) return false;
      if (isRedis && !cat.includes('redis') && !name.includes('redis') && !cat.includes('cache')) return false;

      // Deve conter referência à quantidade de OCPUs e memória
      return (name.includes(`${ocpu} ocpu`) || name.includes(`${ocpu}ocpu`)) &&
             (name.includes(`${mem}gb`) || name.includes(`${mem} gb`));
    }) ?? null;
  }

  // ─── Carregamento do catálogo ─────────────────────────────────────────────
  // Prioridade: arquivo local (catalogs/oci.json) → API em tempo real (fallback)

  private loadCatalog(): Promise<OciProduct[]> {
    if (this.catalog) return Promise.resolve(this.catalog);
    if (this.catalogLoading) return this.catalogLoading;

    this.catalogLoading = (async () => {
      // 1. Tenta ler do arquivo gerado pelo CatalogSyncService
      const cached = readCatalog<{ items: OciProduct[] }>('oci');
      if (cached?.items?.length) {
        this.logger.log(`OCI: usando catálogo local (${cached.items.length} produtos)`);
        this.catalog = cached.items;
        return cached.items;
      }

      // 2. Fallback: busca direta na API
      this.logger.warn('OCI: arquivo de catálogo não encontrado, buscando diretamente na API...');
      const body = await httpsGet(OCI_PRICING_API, 60_000);
      const data = JSON.parse(body) as OciApiResponse;
      const all = data.items ?? [];
      this.catalog = all;
      this.logger.log(`OCI catálogo completo (API): ${all.length} produtos`);
      return all;
    })();

    return this.catalogLoading;
  }
}
