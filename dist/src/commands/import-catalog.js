"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const core_1 = require("@nestjs/core");
const catalog_module_1 = require("../modules/catalog/catalog.module");
const catalog_import_service_1 = require("../modules/catalog/catalog-import.service");
async function bootstrap() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        throw new Error('Uso: npm run catalog:import -- <caminho-do-snapshot.json>');
    }
    const absolutePath = (0, node_path_1.resolve)(process.cwd(), inputPath);
    const contents = await (0, promises_1.readFile)(absolutePath, 'utf8');
    const snapshot = JSON.parse(contents);
    const app = await core_1.NestFactory.createApplicationContext(catalog_module_1.CatalogModule, {
        logger: ['log', 'warn', 'error'],
    });
    try {
        const importer = app.get(catalog_import_service_1.CatalogImportService);
        const result = await importer.importSnapshot(snapshot);
        console.log(`Importação concluída. runId=${result.runId} itens=${result.importedItems}`);
    }
    finally {
        await app.close();
    }
}
bootstrap().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Falha ao importar catálogo: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=import-catalog.js.map