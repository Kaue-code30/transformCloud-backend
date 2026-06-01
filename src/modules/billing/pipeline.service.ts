import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ClaudeService } from './ai/claude.service';
import { PricingOrchestratorService } from './pricing/pricing-orchestrator.service';
import type {
  ParsedBilling,
  PipelineResult,
  PipelineProgressEvent,
  ClassificationResult,
  RecommendationResult,
  PaybackResult,
} from './types/pipeline.types';

@Injectable()
export class PipelineService {
  constructor(
    private readonly claude: ClaudeService,
    private readonly pricing: PricingOrchestratorService,
  ) {}

  // Retorna um Observable de SSE que emite progresso a cada etapa concluída
  runStream(billing: ParsedBilling): Observable<PipelineProgressEvent> {
    return new Observable((subscriber) => {
      (async () => {
        try {
          // Sanitiza input: remove serviços não-técnicos, normaliza nomes, limita top 6
          const billingNormalized = normalizeBilling(billing);

          const partial: Partial<PipelineResult> = { billing: billingNormalized };

          // Etapa 2: mapeamento (Claude)
          subscriber.next({ step: 'mapping', message: `Mapeando ${billingNormalized.topServices.length} serviços com IA...` });
          partial.mappings = await this.claude.mapServices(billingNormalized);
          subscriber.next({
            step: 'mapping',
            message: `${partial.mappings.mappings.length} serviços mapeados`,
            data: { mappings: partial.mappings },
          });

          // Etapa 3+4: preços reais + classificação
          subscriber.next({ step: 'pricing', message: 'Buscando preços em tempo real...' });
          partial.prices = await this.pricing.fetchPrices(billingNormalized, partial.mappings);
          subscriber.next({
            step: 'classification',
            message: `${partial.prices.meta.verifiedServices} serviços verificados (${partial.prices.meta.coveredCostPct}% de cobertura)`,
            data: { prices: partial.prices },
          });

          // Etapa 5: recomendação (Claude)
          subscriber.next({ step: 'recommendation', message: 'Gerando recomendação com IA...' });
          partial.recommendation = await this.claude.generateRecommendation(
            billingNormalized,
            partial.prices,
          );
          subscriber.next({
            step: 'recommendation',
            message: `Recomendação: migrar para ${partial.recommendation.recommendation.provider}`,
            data: { recommendation: partial.recommendation },
          });

          // Etapa 6: payback
          partial.payback = calculatePayback(
            billingNormalized,
            partial.prices,
            partial.recommendation,
          );
          const meta: PipelineResult['meta'] = {
            ...partial.prices.meta,
            analysisDate: new Date().toISOString(),
          };

          const result: PipelineResult = {
            meta,
            billing: billingNormalized,
            mappings: partial.mappings,
            prices: partial.prices,
            recommendation: partial.recommendation,
            payback: partial.payback,
          };

          subscriber.next({
            step: 'done',
            message: 'Análise concluída',
            data: result,
          });

          subscriber.complete();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erro desconhecido';
          subscriber.next({ step: 'error', message });
          subscriber.complete();
        }
      })();
    });
  }
}

// Serviços que não devem ser mapeados — não são serviços cloud técnicos
const NON_TECHNICAL_SERVICES = new Set([
  'tax', 'support', 'credits', 'refund', 'discount',
]);

// Nomes genéricos que o frontend pode enviar → nome canônico AWS para o Claude entender melhor
const SERVICE_NAME_MAP: Record<string, string> = {
  'ec2-instances':    'Amazon EC2',
  'ec2-other':        'Amazon EC2 (EBS/NAT/Transfer)',
  'rds':              'Amazon RDS',
  'relational database service': 'Amazon RDS',
  's3':               'Amazon S3',
  'elastic container service for kubernetes': 'Amazon EKS',
  'eks':              'Amazon EKS',
  'elastic container service': 'Amazon ECS',
  'ecs':              'Amazon ECS',
  'elastic load balancing': 'Amazon Elastic Load Balancing',
  'elb':              'Amazon Elastic Load Balancing',
  'vpc':              'Amazon VPC',
  'cloudwatch':       'Amazon CloudWatch',
  'opensearch service': 'Amazon OpenSearch',
  'elasticsearch service': 'Amazon OpenSearch',
  'documentdb (with mongodb compatibility)': 'Amazon DocumentDB',
  'documentdb':       'Amazon DocumentDB',
};

function normalizeBilling(billing: ParsedBilling): ParsedBilling {
  const filtered = (billing.topServices ?? [])
    // Remove serviços não-técnicos (Tax, Support, Credits, etc.)
    .filter((s) => {
      const lower = (s.name ?? '').toLowerCase().trim();
      return lower && !NON_TECHNICAL_SERVICES.has(lower);
    })
    // Normaliza nomes genéricos para nomes canônicos AWS
    .map((s) => {
      const lower = (s.name ?? '').toLowerCase().trim();
      const canonical = SERVICE_NAME_MAP[lower];
      return {
        ...s,
        name:     canonical ?? s.name ?? 'Serviço desconhecido',
        specs:    s.specs    ?? 'specs não informado',
        quantity: s.quantity ?? 'qtd não informada',
      };
    })
    // Ordena por custo e limita top 6
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 6);

  return {
    ...billing,
    targetRegion: billing.targetRegion ?? undefined,
    topServices: filtered,
  };
}

function calculatePayback(
  billing: ParsedBilling,
  prices: ClassificationResult,
  recommendation: RecommendationResult,
): PaybackResult {
  const provider = recommendation.recommendation.provider.toLowerCase() as
    | 'gcp'
    | 'azure'
    | 'oci';

  const monthlySaving = prices.classified.reduce((acc, c) => {
    const targetPrice =
      provider === 'gcp'
        ? c.gcp.estimatedMonthly
        : provider === 'azure'
          ? c.azure.estimatedMonthly
          : null;
    return targetPrice != null ? acc + (c.currentCost - targetPrice) : acc;
  }, 0);

  const migrationCost = billing.totalCost * 3;
  const paybackMonths = monthlySaving > 0 ? Math.ceil(migrationCost / monthlySaving) : 0;
  const roi = (months: number) =>
    monthlySaving > 0
      ? Math.round(((monthlySaving * months - migrationCost) / migrationCost) * 100)
      : 0;

  return {
    payback: {
      basedOnVerified: recommendation.recommendation.basedOnVerified,
      coveredCostPct: prices.meta.coveredCostPct,
      monthlySaving: Number(monthlySaving.toFixed(2)),
      migrationCost: Number(migrationCost.toFixed(2)),
      paybackMonths,
      roi12m: roi(12),
      roi24m: roi(24),
      roi36m: roi(36),
      breakEvenMonth: paybackMonths,
      disclaimer:
        prices.meta.coveredCostPct < 70
          ? `Atenção: apenas ${prices.meta.coveredCostPct}% do custo foi verificado via API. Projeções são estimativas.`
          : 'Projeções baseadas em preços verificados via APIs dos provedores.',
    },
  };
}
