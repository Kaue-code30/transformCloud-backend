"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const catalog_module_1 = require("../modules/catalog/catalog.module");
const catalog_import_service_1 = require("../modules/catalog/catalog-import.service");
const aws_catalog_adapter_1 = require("../modules/catalog/providers/aws/aws-catalog.adapter");
async function bootstrap() {
    const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
        const [key, ...value] = arg.replace(/^--/, '').split('=');
        return [key, value.join('=')];
    }));
    if (!args.service || !args.region) {
        throw new Error('Uso: npm run catalog:sync:aws -- --service=AmazonEC2 --region=sa-east-1 [--match=m7g.2xlarge] [--max=100]');
    }
    const app = await core_1.NestFactory.createApplicationContext(catalog_module_1.CatalogModule);
    try {
        const adapter = app.get(aws_catalog_adapter_1.AwsCatalogAdapter);
        const importer = app.get(catalog_import_service_1.CatalogImportService);
        const snapshot = await adapter.download({
            serviceCode: args.service,
            region: args.region,
            match: args.match || undefined,
            maxProducts: args.max ? Number(args.max) : 500,
        });
        const result = await importer.importSnapshot(snapshot);
        console.log(`AWS oficial importada: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`);
    }
    finally {
        await app.close();
    }
}
bootstrap().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=sync-aws-catalog.js.map