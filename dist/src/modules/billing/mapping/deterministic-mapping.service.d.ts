import { CatalogRepository } from '../../catalog/catalog.repository';
import type { MappingResult, ParsedBilling } from '../types/pipeline.types';
export declare class DeterministicMappingService {
    private readonly catalog;
    constructor(catalog: CatalogRepository);
    mapServices(billing: ParsedBilling): Promise<MappingResult>;
    private resolveSource;
    private findSourceOffering;
    private findTarget;
}
