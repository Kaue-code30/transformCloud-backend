"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var BillingController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const pipeline_service_1 = require("./pipeline.service");
let BillingController = BillingController_1 = class BillingController {
    pipeline;
    logger = new common_1.Logger(BillingController_1.name);
    constructor(pipeline) {
        this.pipeline = pipeline;
    }
    analyzeStream(billing, res) {
        const itemCount = billing?.lineItems?.length || billing?.topServices?.length || 0;
        this.logger.log(`analyze/stream recebido — provider: ${billing?.provider}, itens: ${itemCount}`);
        if (!billing?.provider || itemCount === 0) {
            res.status(400).json({
                message: 'Body inválido: provider e ao menos um item em lineItems ou topServices são obrigatórios',
            });
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
            error: (err) => {
                const message = err instanceof Error ? err.message : 'Erro desconhecido';
                res.write(`data: ${JSON.stringify({ step: 'error', message })}\n\n`);
                res.end();
            },
        });
        res.on('close', () => sub.unsubscribe());
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Post)('analyze/stream'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "analyzeStream", null);
exports.BillingController = BillingController = BillingController_1 = __decorate([
    (0, common_1.Controller)('billing'),
    __metadata("design:paramtypes", [pipeline_service_1.PipelineService])
], BillingController);
//# sourceMappingURL=billing.controller.js.map