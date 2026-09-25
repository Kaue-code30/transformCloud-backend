import { PricingOrchestratorService } from './pricing-orchestrator.service';
import type { CatalogPricingService } from '../../catalog/catalog-pricing.service';
import type { MappingResult, ParsedBilling } from '../types/pipeline.types';

describe('PricingOrchestratorService', () => {
  it('usa a quantidade real de uma linha cuja unidade é Hrs', async () => {
    const calculate = jest.fn().mockResolvedValue({
      unitPrice: 0.75,
      unit: 'Hrs',
      currency: 'USD',
      estimatedCost: 120,
      source: 'TEST_FIXTURE_ONLY',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    const service = new PricingOrchestratorService({
      calculate,
    } as unknown as CatalogPricingService);
    const billing: ParsedBilling = {
      provider: 'AWS',
      period: { start: '2026-09-01', end: '2026-09-30' },
      currency: 'USD',
      totalCost: 180,
      dataQuality: 'good',
      topServices: [
        {
          sourceLineItemKey: 'compute-line',
          name: 'Amazon EC2 — m7g.2xlarge',
          specs: 'm7g.2xlarge',
          cost: 180,
          pct: 100,
          quantity: '160 Hrs',
          usageQuantity: 160,
          usageUnit: 'Hrs',
        },
      ],
      lineItems: [
        {
          sourceKey: 'compute-line',
          provider: 'AWS',
          serviceCode: 'AmazonEC2',
          region: 'sa-east-1',
          quantity: 160,
          unit: 'Hrs',
          cost: 180,
          currency: 'USD',
        },
      ],
    };
    const mappings: MappingResult = {
      mappings: [
        {
          original: 'Amazon EC2 — m7g.2xlarge',
          gcp: {
            catalogOfferingId: 'gcp-offering',
            matchType: 'exact_capacity',
            score: 0,
            evidence: ['teste'],
            service: 'Compute Engine',
            machineType: 't2a-standard-8',
            region: 'southamerica-east1',
            confidence: 'high',
          },
        },
      ],
      unmapped: [],
    };

    await service.fetchPrices(billing, mappings);

    expect(calculate).toHaveBeenCalledWith('gcp-offering', 160);
  });
});
