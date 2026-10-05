import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { CatalogImportService } from '../modules/catalog/catalog-import.service';
import type { CatalogResourceKind } from '../modules/catalog/catalog.types';
import { AzureCatalogAdapter } from '../modules/catalog/providers/azure/azure-catalog.adapter';

async function bootstrap() {
  const args = parseArgs();
  if (!args.service || !args.region) {
    throw new Error(
      'Uso: npm run catalog:sync:azure -- --service="Virtual Machines" --region=brazilsouth [--match=Standard_D8ps_v5] [--kind=COMPUTE_VM] [--vcpu=8] [--memory=32] [--max=100]',
    );
  }
  const app = await NestFactory.createApplicationContext(CatalogModule);
  try {
    const adapter = app.get(AzureCatalogAdapter);
    const importer = app.get(CatalogImportService);
    const snapshot = await adapter.download({
      service: args.service,
      region: args.region,
      match: args.match || undefined,
      productName: args.product || undefined,
      meterName: args.meter || undefined,
      skuName: args.sku || undefined,
      armSkuName: args.armSku || undefined,
      resourceKind: args.kind as CatalogResourceKind | undefined,
      offeringName: args.offering || undefined,
      vcpu: optionalNumber(args.vcpu),
      memoryGiB: optionalNumber(args.memory),
      operatingSystem: args.os || undefined,
      architecture: args.arch || undefined,
      engine: args.engine || undefined,
      maxItems: optionalNumber(args.max) ?? 500,
    });
    const result = await importer.importSnapshot(snapshot);
    console.log(
      `Azure oficial importado: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`,
    );
  } finally {
    await app.close();
  }
}

function parseArgs(): Record<string, string> {
  return Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...value] = arg.replace(/^--/, '').split('=');
      return [key, value.join('=')];
    }),
  );
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Valor numérico inválido: ${value}`);
  }
  return parsed;
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
