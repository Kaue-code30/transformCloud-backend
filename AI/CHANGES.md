# Log de Mudanças — Backend

> Registra todas as mudanças feitas por sessões de IA no backend.
> Sempre adicione uma entrada no topo ao fazer alterações.

---

## Como usar

```markdown
## [YYYY-MM-DD] — Título da Sessão

**Objetivo:** O que foi pedido.

**Arquivos alterados:**
- `caminho/arquivo.ts` — descrição

**Descrição:**
O que foi feito, por que, decisões importantes.

**Observações:**
Débitos técnicos, próximos passos, pontos de atenção.
```

---

## [2026-05-21] — Users: Troca de Senha com Validação da Senha Atual

**Objetivo:** Endpoint autenticado para o usuário alterar a própria senha a partir do perfil, exigindo confirmação da senha atual.

**Arquivos criados:**
- `src/modules/users/dto/change-password.dto.ts` — `{ currentPassword, newPassword (min 8) }`

**Arquivos alterados:**
- `src/modules/users/users.service.ts` — adicionado `changePassword()`: verifica senha atual com bcrypt, atualiza hash
- `src/modules/users/users.controller.ts` — adicionado `PATCH /users/me/password` (protegido por JWT)
- `AI/MODULES/USERS.md` — criado com documentação do módulo
- `AI/PROJECT_CONTEXT.md` — tabela de endpoints atualizada

**Descrição:**
Endpoint separado de `PATCH /users/me` para troca de senha, exigindo validação da senha atual antes de aplicar a nova. Retorna 401 se a senha atual estiver incorreta. Não invalida refresh tokens existentes (o usuário está logado e está fazendo a mudança conscientemente).

**Observações:**
- Diferença intencional em relação ao `reset-password`: aquele invalida todos os refresh tokens (fluxo de recuperação), este não (fluxo de perfil logado).

---

## [2026-05-21] — Auth: Endpoint de Reset de Senha

**Objetivo:** Implementar `POST /auth/reset-password` para completar o fluxo de recuperação de senha iniciado pelo `forgot-password`.

**Arquivos criados:**
- `src/modules/auth/dto/reset-password.dto.ts` — `{ token: string, newPassword (min 8) }`

**Arquivos alterados:**
- `src/modules/auth/auth.service.ts` — adicionado `resetPassword()`: valida JWT, verifica `purpose`, atualiza hash, invalida refresh tokens
- `src/modules/auth/auth.controller.ts` — adicionado `POST /auth/reset-password`
- `AI/MODULES/AUTH.md` — documentação atualizada com novo endpoint e fluxo completo

**Descrição:**
O endpoint recebe o token gerado pelo `forgot-password` e a nova senha. Valida o JWT com `JWT_RESET_SECRET` (400 se expirado/inválido) e confere que `payload.purpose === 'password-reset'` para evitar reutilização de access tokens no reset. Após alterar a senha, deleta todos os refresh tokens do usuário para forçar novo login em todos os dispositivos.

**Observações:**
- Token de reset não é persistido no banco — não pode ser invalidado antes de expirar (limitação do MVP).
- Integração com envio de e-mail ainda pendente; token continua aparecendo apenas no console.

---

## [2026-05-21] — Auth: Endpoint de Esqueci Senha

**Objetivo:** Criar endpoint de recuperação de senha (esqueci senha) no módulo de autenticação.

**Arquivos criados:**
- `src/modules/auth/dto/forgot-password.dto.ts` — DTO com validação de e-mail

**Arquivos alterados:**
- `src/modules/auth/auth.controller.ts` — adicionado `POST /auth/forgot-password`
- `src/modules/auth/auth.service.ts` — adicionada lógica `forgotPassword()` com resposta neutra e geração de token temporário
- `AI/MODULES/AUTH.md` — documentação do módulo auth atualizada com novo endpoint
- `AI/PROJECT_CONTEXT.md` — tabela de endpoints atualizada

**Descrição:**
Foi adicionado o endpoint `POST /api/auth/forgot-password` para iniciar recuperação de senha. A resposta é sempre neutra para evitar enumeração de usuários por e-mail. Quando o usuário existe, o backend gera um token JWT temporário de reset (`purpose: password-reset`, padrão `15m`) e registra no log para integração futura com serviço de e-mail.

**Observações:**
- Variáveis opcionais para customização: `JWT_RESET_SECRET` e `JWT_RESET_EXPIRES_IN`.
- Próximo passo recomendado: implementar endpoint de confirmação de reset (`POST /auth/reset-password`) e envio real de e-mail.

## [2026-05-21] — Billing Pipeline V2: Etapas 3 e 4 (APIs de Preços)

**Objetivo:** Implementar os clientes das APIs públicas de preços (Azure, AWS, GCP) e a lógica de classificação de confiança conforme `ARCHITECTURE_BILLING_V2.md`.

**Arquivos criados:**
- `src/modules/billing/types/pipeline.types.ts` — todos os tipos TypeScript das 6 etapas do pipeline
- `src/modules/billing/pricing/azure-pricing.service.ts` — cliente Azure Retail Prices API (pública, sem auth)
- `src/modules/billing/pricing/aws-pricing.service.ts` — cliente AWS Pricing API (pública, sem auth)
- `src/modules/billing/pricing/gcp-pricing.service.ts` — cliente GCP Cloud Billing API (requer `GCP_API_KEY`)
- `src/modules/billing/pricing/pricing-orchestrator.service.ts` — orquestra chamadas paralelas às 3 APIs + classificação (Etapas 3+4)
- `AI/MODULES/BILLING.md` — documentação completa do módulo billing

**Arquivos alterados:**
- `src/modules/billing/billing.module.ts` — registra e exporta os 4 providers de pricing
- `src/main.ts` — adicionado `import 'dotenv/config'` para garantir env vars antes de qualquer instanciação
- `src/prisma/prisma.service.ts` — corrigido para usar `@prisma/adapter-pg` (Prisma 7 breaking change)

**Correções de setup (Prisma 7):**
- Substituído import relativo `../../node_modules/.prisma/client/index.js` por `@prisma/client`
- Instalado `@prisma/adapter-pg` + `pg` — Prisma 7 exige adapter explícito no construtor (não lê `DATABASE_URL` automaticamente em runtime)
- `schema.prisma`: `url` removido do datasource (breaking change Prisma 7 — URL fica só em `prisma.config.ts`)

**Descrição:**
Implementação da Etapa 3 do pipeline V2 como três services independentes (um por provedor). Chamadas são feitas em paralelo via `Promise.all` no `PricingOrchestratorService`. OCI é hardcoded como `no_api` — sem API pública disponível.

A Etapa 4 (classificação) é aplicada dentro do mesmo orquestrador: cruza `verified` da API com `confidence` do mapeamento Claude para determinar o status final (`verified` / `partial` / `not_found` / `no_api`) e calcula `coveredCostPct`.

**Observações:**
- `GCP_API_KEY` precisa ser adicionada ao `.env` — chave pública (sem OAuth), criada em console.cloud.google.com com Cloud Billing API habilitada.
- AWS `index.json` é pesado (~100MB para EC2); timeout em 15s. Considerar cache Redis nas próximas iterações.
- Próximas etapas: parser de billing (Etapa 1), prompt Claude mapeamento (Etapa 2), prompt Claude recomendação (Etapa 5), cálculo payback (Etapa 6), controller `POST /billing/analyze`.

---

## [2026-05-21] — Setup Inicial do Backend

**Objetivo:** Criar o backend NestJS com Auth + Users como base para funcionalidades futuras (billing pipeline V2, migrações, observabilidade, integrações de cloud).

**Arquivos criados:**
- `prisma/schema.prisma` — models User, RefreshToken, CloudIntegration, BillingAnalysis
- `prisma.config.ts` — configuração Prisma 7 (gerado automaticamente pelo `prisma init`)
- `src/main.ts` — bootstrap porta 3001, CORS, ValidationPipe global
- `src/app.module.ts` — módulo raiz com todos os imports
- `src/prisma/prisma.service.ts` — PrismaClient como serviço NestJS global
- `src/prisma/prisma.module.ts` — módulo global do Prisma
- `src/modules/auth/` — AuthModule completo (register, login, refresh, logout, JWT strategy)
- `src/modules/users/` — UsersModule (GET/PATCH /me protegidos por JWT)
- `src/modules/billing/billing.module.ts` — scaffold vazio
- `src/modules/migrations/migrations.module.ts` — scaffold vazio
- `src/modules/observability/observability.module.ts` — scaffold vazio
- `src/modules/integrations/integrations.module.ts` — scaffold vazio
- `.env` / `.env.example` — variáveis de ambiente
- `AI/PROJECT_CONTEXT.md` — documentação de contexto
- `AI/CHANGES.md` — este arquivo

**Descrição:**
Projeto NestJS scaffoldado via `nest new`. Dependências instaladas: `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`, `@prisma/client`, `prisma`, `class-validator`, `class-transformer`, `@nestjs/config`.

Prisma 7 tem breaking changes: `url` removido do `schema.prisma`, passa a viver em `prisma.config.ts`. O import do `PrismaClient` foi feito diretamente de `../../node_modules/.prisma/client/index.js` por incompatibilidade de resolução de módulos com `moduleResolution: nodenext`.

**Observações:**
- Módulos billing, migrations, observability e integrations são scaffolds vazios — prontos para receber implementação.
- O pipeline V2 de billing está documentado em `../AI/ARCHITECTURE_BILLING_V2.md` (pasta AI do frontend).
- Refresh token usa rotação: cada `/refresh` invalida o token usado e gera um novo par.
