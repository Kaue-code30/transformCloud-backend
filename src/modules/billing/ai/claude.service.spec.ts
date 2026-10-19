import type { ConfigService } from '@nestjs/config';
import { ClaudeService } from './claude.service';
import type {
  ClassificationResult,
  ClassifiedPrice,
  ParsedBilling,
  PriceEntry,
} from '../types/pipeline.types';

describe('ClaudeService migration complexity', () => {
  it('explica como média quando parte dos serviços exige validação', async () => {
    const service = createService();

    const result = await service.generateRecommendation(
      billing(),
      pricesWithPartialOciCoverage(),
    );

    expect(result.recommendation).toMatchObject({
      provider: 'OCI',
      migrationComplexity: 'medium',
      migrationComplexityDetails: {
        basis: 'catalog_compatibility',
        isMigration: true,
        verifiedServices: 1,
        totalServices: 2,
        coveredCostPct: 33,
        attentionPoints: [
          {
            service: 'Amazon RDS',
            status: 'not_found',
            reason: 'Sem mapeamento determinístico para OCI',
          },
        ],
      },
    });
    expect(result.recommendation.migrationComplexityDetails.summary).toContain(
      '1 de 2 serviços',
    );
    expect(result.recommendation.migrationComplexityDetails.disclaimer).toContain(
      'não avalia código',
    );
  });

  it('não permite que a redação por IA altere a complexidade calculada', async () => {
    const service = createService('test-api-key');
    const ask = jest.spyOn(
      service as unknown as {
        ask(prompt: string, maxTokens: number): Promise<string | null>;
      },
      'ask',
    );
    ask.mockResolvedValue(JSON.stringify({
      recommendation: {
        provider: 'GCP',
        basedOnVerified: true,
        migrationComplexity: 'high',
        reasons: ['Texto reescrito'],
        topServices: ['Amazon EC2'],
        cfa_justification: 'Texto reescrito',
      },
      insights: [],
      summary: 'Texto reescrito',
    }));

    const result = await service.generateRecommendation(
      billing(),
      pricesWithPartialOciCoverage(),
    );

    expect(result.recommendation.provider).toBe('OCI');
    expect(result.recommendation.migrationComplexity).toBe('medium');
    expect(result.recommendation.migrationComplexityDetails.attentionPoints)
      .toHaveLength(1);
  });
});

function createService(apiKey?: string): ClaudeService {
  return new ClaudeService({
    get: jest.fn().mockReturnValue(apiKey),
  } as unknown as ConfigService);
}

function billing(): ParsedBilling {
  return {
    provider: 'AWS',
    period: { start: '2026-09-01', end: '2026-09-30' },
    currency: 'USD',
    totalCost: 300,
    dataQuality: 'good',
    topServices: [],
  };
}

function pricesWithPartialOciCoverage(): ClassificationResult {
  return {
    classified: [
      classifiedPrice('Amazon EC2', 100, verifiedPrice(50), 'verified'),
      classifiedPrice(
        'Amazon RDS',
        200,
        unavailablePrice('Sem mapeamento determinístico para OCI'),
        'not_found',
      ),
    ],
    meta: {
      analyzedServices: 2,
      verifiedServices: 1,
      partialServices: 0,
      notFoundServices: 1,
      coveredCostPct: 33,
    },
  };
}

function classifiedPrice(
  service: string,
  currentCost: number,
  oci: PriceEntry,
  ociStatus: ClassifiedPrice['ociStatus'],
): ClassifiedPrice {
  const unavailable = unavailablePrice('Sem mapeamento para o provedor');
  return {
    service,
    currentCost,
    aws: unavailable,
    gcp: unavailable,
    azure: unavailable,
    oci,
    awsStatus: 'not_found',
    gcpStatus: 'not_found',
    azureStatus: 'not_found',
    ociStatus,
  };
}

function verifiedPrice(estimatedMonthly: number): PriceEntry {
  return {
    price: 1,
    currency: 'USD',
    estimatedMonthly,
    verified: true,
  };
}

function unavailablePrice(reason: string): PriceEntry {
  return {
    price: null,
    estimatedMonthly: null,
    verified: false,
    reason,
  };
}
