import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { CatalogImportService } from '../modules/catalog/catalog-import.service';
import type { CatalogSnapshot } from '../modules/catalog/catalog.types';

async function bootstrap() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      'Uso: npm run catalog:import -- <caminho-do-snapshot.json>',
    );
  }

  const absolutePath = resolve(process.cwd(), inputPath);
  const contents = await readFile(absolutePath, 'utf8');
  const snapshot = JSON.parse(contents) as CatalogSnapshot;
  const app = await NestFactory.createApplicationContext(CatalogModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const importer = app.get(CatalogImportService);
    const result = await importer.importSnapshot(snapshot);
    console.log(
      `Importação concluída. runId=${result.runId} itens=${result.importedItems}`,
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha ao importar catálogo: ${message}`);
  process.exitCode = 1;
});
