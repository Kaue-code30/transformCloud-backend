import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { CatalogImportService } from '../modules/catalog/catalog-import.service';
import { GcpCatalogAdapter } from '../modules/catalog/providers/gcp/gcp-catalog.adapter';

async function bootstrap() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }));
  const apiKey = process.env.GCP_API_KEY ?? '';
  if (!apiKey || !args.service || !args.region) {
    throw new Error('Configure GCP_API_KEY. Uso: npm run catalog:sync:gcp -- --service="Cloud Functions" --region=southamerica-east1 [--match=...] [--max=500]');
  }
  const app = await NestFactory.createApplicationContext(CatalogModule);
  try {
    const snapshot = await app.get(GcpCatalogAdapter).download({
      apiKey, service: args.service, region: args.region,
      match: args.match || undefined, maxSkus: args.max ? Number(args.max) : 500,
    });
    const result = await app.get(CatalogImportService).importSnapshot(snapshot);
    console.log(`GCP oficial importado: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`);
  } finally { await app.close(); }
}
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
