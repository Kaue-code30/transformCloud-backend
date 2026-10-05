"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const catalog_module_1 = require("../modules/catalog/catalog.module");
const catalog_import_service_1 = require("../modules/catalog/catalog-import.service");
const oci_catalog_adapter_1 = require("../modules/catalog/providers/oci/oci-catalog.adapter");
async function bootstrap() {
    const args = parseArgs();
    if (!args.region || (!args.match && !args.partNumber && !args.partNumbers)) {
        throw new Error('Uso: npm run catalog:sync:oci -- --region=sa-saopaulo-1 (--match="Object Storage - Storage" | --partNumber=B91628 | --partNumbers=B93297,B93298) [--kind=OBJECT_STORAGE] [--offering=...] [--max=100]');
    }
    const app = await core_1.NestFactory.createApplicationContext(catalog_module_1.CatalogModule);
    try {
        const adapter = app.get(oci_catalog_adapter_1.OciCatalogAdapter);
        const importer = app.get(catalog_import_service_1.CatalogImportService);
        const snapshot = await adapter.download({
            region: args.region,
            partNumber: args.partNumber || undefined,
            partNumbers: args.partNumbers
                ? args.partNumbers.split(',').map((value) => value.trim()).filter(Boolean)
                : undefined,
            match: args.match || undefined,
            resourceKind: args.kind,
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
        console.log(`OCI oficial importado: ofertas=${snapshot.offerings.length} medidores=${snapshot.meters.length} itens=${result.importedItems}`);
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
//# sourceMappingURL=sync-oci-catalog.js.map