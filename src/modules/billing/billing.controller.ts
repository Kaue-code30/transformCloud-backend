import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PipelineService } from './pipeline.service';
import type { ParsedBilling } from './types/pipeline.types';

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly pipeline: PipelineService) {}

  @Post('analyze/stream')
  analyzeStream(@Body() billing: ParsedBilling, @Res() res: Response): void {
    this.logger.log(`analyze/stream recebido — provider: ${billing?.provider}, serviços: ${billing?.topServices?.length ?? 'null'}`);
    if (!billing?.provider || !billing?.topServices?.length) {
      res.status(400).json({ message: 'Body inválido: provider e topServices são obrigatórios' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sub = this.pipeline.runStream(billing).subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      complete: () => res.end(),
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Erro desconhecido';
        res.write(`data: ${JSON.stringify({ step: 'error', message })}\n\n`);
        res.end();
      },
    });

    res.on('close', () => sub.unsubscribe());
  }
}
