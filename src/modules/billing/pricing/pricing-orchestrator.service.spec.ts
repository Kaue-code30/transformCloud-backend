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
      complete: true,
      limitations: [],
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

  it('classifica preço incompleto como parcial, preservando o valor para auditoria', async () => {
    const calculate = jest.fn().mockResolvedValue({
      unitPrice: 0.098,
      unit: 'Hrs',
      currency: 'USD',
      estimatedCost: 70.56,
      source: 'OCI_PUBLIC_PRICE_LIST_API — preço público sem franquias por conta',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      complete: false,
      limitations: ['Armazenamento otimizado não incluído'],
    });
    const service = new PricingOrchestratorService({
      calculate,
    } as unknown as CatalogPricingService);
    const billing: ParsedBilling = {
      provider: 'AWS',
      period: { start: '2026-09-01', end: '2026-09-30' },
      currency: 'USD',
      totalCost: 100,
      dataQuality: 'good',
      topServices: [{
        sourceLineItemKey: 'database-line',
        name: 'Amazon RDS',
        specs: 'db.r6g.large',
        cost: 100,
        pct: 100,
        quantity: '720 Hrs',
        usageQuantity: 720,
        usageUnit: 'Hrs',
      }],
      lineItems: [{
        sourceKey: 'database-line',
        provider: 'AWS',
        serviceCode: 'AmazonRDS',
        region: 'sa-east-1',
        quantity: 720,
        unit: 'Hrs',
        cost: 100,
        currency: 'USD',
      }],
    };
    const mappings: MappingResult = {
      mappings: [{
        original: 'Amazon RDS',
        oci: {
          catalogOfferingId: 'oci-postgresql',
          matchType: 'exact_capacity',
          score: 0,
          evidence: ['teste'],
          service: 'Database with PostgreSQL',
          shape: 'PostgreSQL-2-16',
          region: 'sa-saopaulo-1',
          confidence: 'high',
        },
      }],
      unmapped: [],
    };

    const result = await service.fetchPrices(billing, mappings);

    expect(result.classified[0]).toMatchObject({
      ociStatus: 'partial',
      oci: {
        estimatedMonthly: 70.56,
        verified: false,
        reason: 'Armazenamento otimizado não incluído',
      },
    });
    expect(result.meta).toMatchObject({
      verifiedServices: 0,
      partialServices: 1,
      coveredCostPct: 0,
    });
  });
});
