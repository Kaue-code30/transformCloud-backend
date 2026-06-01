import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { OciMapping, PriceEntry } from '../types/pipeline.types';

const OCI_PRICING_API = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/';

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
  offset?: number;
  limit?: number;
}

// OCI Flex shapes cobram separadamente OCPU e memória — precisamos de ambos os part numbers.
// Mapa: shape → { ocpuPartNumber, memPartNumber }
// Fonte: https://www.oracle.com/cloud/price-list/
const OCI_SHAPE_PARTS: Record<string, { ocpu: string; mem: string }> = {
  // Standard — AMD E4
  'VM.Standard.E4.Flex':  { ocpu: 'B88317', mem: 'B88318' },
  'BM.Standard.E4.128':   { ocpu: 'B88317', mem: 'B88318' },
  // Standard — AMD E3
  'VM.Standard.E3.Flex':  { ocpu: 'B88265', mem: 'B88266' },
  // Standard — Intel X9
  'VM.Standard3.Flex':    { ocpu: 'B88571', mem: 'B88572' },
  // Optimized — Intel X9
  'VM.Optimized3.Flex':   { ocpu: 'B88573', mem: 'B88574' },
  // Standard A1 — Ampere (ARM)
  'VM.Standard.A1.Flex':  { ocpu: 'B88514', mem: 'B88515' },
  // GPU A10
  'VM.GPU.A10.1':         { ocpu: 'B90564', mem: 'B90564' },
  // MySQL Database Service — OCPU based (single part covers compute)
  'MySQL.VM.Standard.E3.1.8GB':   { ocpu: 'B88366', mem: 'B88366' },
  'MySQL.VM.Standard.E3.2.16GB':  { ocpu: 'B88367', mem: 'B88367' },
  'MySQL.VM.Standard.E3.4.32GB':  { ocpu: 'B88368', mem: 'B88368' },
  'MySQL.VM.Standard.E3.8.64GB':  { ocpu: 'B88369', mem: 'B88369' },
  'MySQL.VM.Standard.E3.4.64GB':  { ocpu: 'B88370', mem: 'B88370' },
  'MySQL.VM.Standard.E3.8.128GB': { ocpu: 'B88371', mem: 'B88371' },
  'MySQL.VM.Standard.E3.16.256GB':{ ocpu: 'B88372', mem: 'B88372' },
  // Cache with Redis
  'BM.Standard.E2.64':    { ocpu: 'B89071', mem: 'B89072' },
};

// Serviços MySQL/Cache: têm um único partNumber que cobre a instância completa (não Flex)
const FIXED_SHAPE_PARTS = new Set([
  'MySQL.VM.Standard.E3.1.8GB',
  'MySQL.VM.Standard.E3.2.16GB',
  'MySQL.VM.Standard.E3.4.32GB',
  'MySQL.VM.Standard.E3.8.64GB',
  'MySQL.VM.Standard.E3.4.64GB',
  'MySQL.VM.Standard.E3.8.128GB',
  'MySQL.VM.Standard.E3.16.256GB',
  'BM.Standard.E2.64',
]);

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('OCI API timeout')); });
    req.on('error', reject);
  });
}

function extractUsdPrice(product: OciProduct): number | null {
  const usd = product.currencyCodeLocalizations.find((c) => c.currencyCode === 'USD');
  if (!usd) return null;
  const payg = usd.prices.find((p) => p.model === 'PAY_AS_YOU_GO');
  return payg ? payg.value : null;
}

@Injectable()
export class OciPricingService {
  private readonly logger = new Logger(OciPricingService.name);

  // Cache em memória por partNumber para evitar chamadas repetidas na mesma requisição
  private readonly cache = new Map<string, OciProduct | null>();

  async getPrice(mapping: OciMapping, quantityHours: number): Promise<PriceEntry> {
    const shape = mapping.shape;
    if (!shape) {
      return { price: null, verified: false, reason: 'OCI shape não informado' };
    }

    const parts = OCI_SHAPE_PARTS[shape];
    if (!parts) {
      return { price: null, verified: false, reason: `Shape ${shape} não mapeado para part numbers OCI` };
    }

    try {
      const isFixed = FIXED_SHAPE_PARTS.has(shape);

      if (isFixed) {
        // Um único part number cobre a instância completa (preço por hora)
        const product = await this.fetchProduct(parts.ocpu);
        if (!product) {
          return { price: null, verified: false, reason: `Part number ${parts.ocpu} não encontrado na OCI API` };
        }

        const hourlyPrice = extractUsdPrice(product);
        if (hourlyPrice === null) {
          return { price: null, verified: false, reason: 'Preço USD não encontrado no produto OCI' };
        }

        return {
          price: hourlyPrice,
          unit: 'hora',
          estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
          source: 'OCI Pricing API',
          verified: true,
        };
      }

      // Flex shape: preço = (ocpuPrice × ocpu) + (memPrice × memGb)  — por hora
      const ocpu   = mapping.ocpu   ?? 1;
      const memGb  = mapping.memoryGb ?? 8;

      const [ocpuProduct, memProduct] = await Promise.all([
        this.fetchProduct(parts.ocpu),
        parts.ocpu === parts.mem ? Promise.resolve(null) : this.fetchProduct(parts.mem),
      ]);

      if (!ocpuProduct) {
        return { price: null, verified: false, reason: `Part number OCPU ${parts.ocpu} não encontrado` };
      }

      const ocpuUnitPrice = extractUsdPrice(ocpuProduct);
      if (ocpuUnitPrice === null) {
        return { price: null, verified: false, reason: 'Preço OCPU USD não disponível' };
      }

      // Se os dois part numbers forem iguais (edge case), usa o mesmo produto para memória
      const resolvedMemProduct = memProduct ?? ocpuProduct;
      const memUnitPrice = extractUsdPrice(resolvedMemProduct);
      if (memUnitPrice === null) {
        return { price: null, verified: false, reason: 'Preço Memory USD não disponível' };
      }

      const hourlyPrice = (ocpuUnitPrice * ocpu) + (memUnitPrice * memGb);

      return {
        price: Number(hourlyPrice.toFixed(6)),
        unit: 'hora',
        estimatedMonthly: Number((hourlyPrice * quantityHours).toFixed(2)),
        source: 'OCI Pricing API',
        verified: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Erro OCI Pricing API: ${msg}`);
      return { price: null, verified: false, reason: `Erro na requisição OCI: ${msg}` };
    }
  }

  private async fetchProduct(partNumber: string): Promise<OciProduct | null> {
    if (this.cache.has(partNumber)) {
      return this.cache.get(partNumber) ?? null;
    }

    const url = `${OCI_PRICING_API}?partNumber=${encodeURIComponent(partNumber)}`;
    const body = await httpsGet(url, 10000);
    const data = JSON.parse(body) as OciApiResponse;

    const product = data.items?.[0] ?? null;
    this.cache.set(partNumber, product);

    if (!product) {
      this.logger.warn(`OCI: partNumber ${partNumber} não retornou item`);
    }

    return product;
  }
}
