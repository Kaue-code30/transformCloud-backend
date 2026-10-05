"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const catalog_module_1 = require("../modules/catalog/catalog.module");
const catalog_import_service_1 = require("../modules/catalog/catalog-import.service");
const azure_catalog_adapter_1 = require("../modules/catalog/providers/azure/azure-catalog.adapter");
async function bootstrap() {
    const args = parseArgs();
    if (!args.service || !args.region) {
        throw new Error('Uso: npm run catalog:sync:azure -- --service="Virtual Machines" --region=brazilsouth [--match=Standard_D8ps_v5] [--kind=COMPUTE_VM] [--vcpu=8] [--memory=32] [--max=100]');
    }
    const app = await core_1.NestFactory.createApplicationContext(catalog_module_1.CatalogModule);
    try {
        const adapter = app.get(azure_catalog_adapter_1.AzureCatalogAdapter);
        const importer = app.get(catalog_import_service_1.CatalogImportService);
        const snapshot = await adapter.download({
            service: args.service,
            region: args.region,
            match: args.match || undefined,
            productName: args.product || undefined,
            meterName: args.meter || undefined,
            skuName: args.sku || undefined,
            armSkuName: args.armSku || undefined,
            resourceKind: args.kind,
            offeringName: args.offering || undefined,
            vcpu: optionalNumber(args.vcpu),
            memoryGiB: optionalNumber(args.memory),
            operatingSystem: args.os || undefined,
            architecture: args.arch || undefined,
            engine: args.engine || undefined,
            maxItems: optionalNumber(args.max) ?? 500,
        });
        const result = await importer.importSnapshot(snapshot);
        console.log(`Azure oficial importado: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`);
    }
    finally {
        await app.close();
    }
}
function parseArgs() {
    return Object.fromEntries(process.argv.slice(2).map((arg) => {
        const [key, ...value] = arg.replace(/^--/, '').split('=');
        return [key, value.join('=')];
    }));
}
function optionalNumber(value) {
    if (!value)
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Valor numérico inválido: ${value}`);
    }
    return parsed;
}
bootstrap().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=sync-azure-catalog.js.map