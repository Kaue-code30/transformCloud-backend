import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { CatalogImportService } from '../modules/catalog/catalog-import.service';
import type { CatalogResourceKind } from '../modules/catalog/catalog.types';
import { OciCatalogAdapter } from '../modules/catalog/providers/oci/oci-catalog.adapter';

async function bootstrap() {
  const args = parseArgs();
  if (!args.region || (!args.match && !args.partNumber && !args.partNumbers)) {
    throw new Error(
      'Uso: npm run catalog:sync:oci -- --region=sa-saopaulo-1 (--match="Object Storage - Storage" | --partNumber=B91628 | --partNumbers=B93297,B93298) [--kind=OBJECT_STORAGE] [--offering=...] [--max=100]',
    );
  }
  const app = await NestFactory.createApplicationContext(CatalogModule);
  try {
    const adapter = app.get(OciCatalogAdapter);
    const importer = app.get(CatalogImportService);
    const snapshot = await adapter.download({
      region: args.region,
      partNumber: args.partNumber || undefined,
      partNumbers: args.partNumbers
        ? args.partNumbers.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      match: args.match || undefined,
      resourceKind: args.kind as CatalogResourceKind | undefined,
      offeringName: args.offering || undefined,
      vcpu: optionalNumber(args.vcpu),
      ocpu: optionalNumber(args.ocpu),
      memoryGiB: optionalNumber(args.memory),
      operatingSystem: args.os || undefined,
      architecture: args.arch || undefined,
      engine: args.engine || undefined,
      maxProducts: optionalNumber(args.max) ?? 500,
    });
    const result = await importer.importSnapshot(snapshot);
    console.log(
      `OCI oficial importado: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`,
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
