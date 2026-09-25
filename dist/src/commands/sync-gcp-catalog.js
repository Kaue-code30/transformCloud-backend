"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const catalog_module_1 = require("../modules/catalog/catalog.module");
const catalog_import_service_1 = require("../modules/catalog/catalog-import.service");
const gcp_catalog_adapter_1 = require("../modules/catalog/providers/gcp/gcp-catalog.adapter");
async function bootstrap() {
    const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
        const [key, ...value] = arg.replace(/^--/, '').split('=');
        return [key, value.join('=')];
    }));
    const apiKey = process.env.GCP_API_KEY ?? '';
    if (!apiKey || !args.service || !args.region) {
        throw new Error('Configure GCP_API_KEY. Uso: npm run catalog:sync:gcp -- --service="Cloud Functions" --region=southamerica-east1 [--match=...] [--max=500]');
    }
    const app = await core_1.NestFactory.createApplicationContext(catalog_module_1.CatalogModule);
    try {
        const snapshot = await app.get(gcp_catalog_adapter_1.GcpCatalogAdapter).download({
            apiKey, service: args.service, region: args.region,
            match: args.match || undefined, maxSkus: args.max ? Number(args.max) : 500,
        });
        const result = await app.get(catalog_import_service_1.CatalogImportService).importSnapshot(snapshot);
        console.log(`GCP oficial importado: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`);
    }
    finally {
        await app.close();
    }
}
bootstrap().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=sync-gcp-catalog.js.map