import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { CatalogImportService } from '../modules/catalog/catalog-import.service';
import { AwsCatalogAdapter } from '../modules/catalog/providers/aws/aws-catalog.adapter';

async function bootstrap() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }));
  if (!args.service || !args.region) {
    throw new Error('Uso: npm run catalog:sync:aws -- --service=AmazonEC2 --region=sa-east-1 [--match=m7g.2xlarge] [--max=100]');
  }
  const app = await NestFactory.createApplicationContext(CatalogModule);
  try {
    const adapter = app.get(AwsCatalogAdapter);
    const importer = app.get(CatalogImportService);
    const snapshot = await adapter.download({
      serviceCode: args.service,
      region: args.region,
      match: args.match || undefined,
      maxProducts: args.max ? Number(args.max) : 500,
    });
    const result = await importer.importSnapshot(snapshot);
    console.log(`AWS oficial importada: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`);
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
