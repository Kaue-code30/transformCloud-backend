import { PrismaService } from '../../prisma/prisma.service';
import { CatalogRepository } from './catalog.repository';
import type { CatalogSnapshot } from './catalog.types';
export declare class CatalogImportService {
    private readonly prisma;
    private readonly catalog;
    private readonly logger;
    constructor(prisma: PrismaService, catalog: CatalogRepository);
    importSnapshot(snapshot: CatalogSnapshot): Promise<{
        runId: string;
        importedItems: number;
    }>;
}
