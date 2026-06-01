# Log de Mudanças — Backend

> Registra todas as mudanças feitas por sessões de IA no backend.
> Sempre adicione uma entrada no topo ao fazer alterações.

---

## [2026-05-22] — Billing Pipeline V2: Pipeline Completo + SSE + Melhorias de Cobertura

**Objetivo:** Completar as etapas 2, 5 e 6 do pipeline (Claude), expor endpoint SSE para o frontend, e maximizar a taxa de match nas APIs de preço.

**Arquivos criados:**
- `src/modules/billing/ai/claude.service.ts` — Etapas 2 (mapeamento) e 5 (recomendação) via Claude Opus 4.7 com prompt caching
- `src/modules/billing/pipeline.service.ts` — orquestra as 6 etapas e emite Observable SSE com progresso
- `src/modules/billing/billing.controller.ts` — `POST /api/billing/analyze/stream` (SSE via node:https)

**Arquivos alterados:**
- `src/modules/billing/billing.module.ts` — registra `ClaudeService`, `PipelineService`, `BillingController`
- `src/modules/billing/types/pipeline.types.ts` — adicionados `PipelineStep`, `PipelineProgressEvent`, campo `targetRegion` em `ParsedBilling`
- `src/modules/billing/pricing/azure-pricing.service.ts` — substituído `fetch` por `node:https`; filtro por `armSkuName contains` com 3 tentativas (exact → contains → sem região); log de debug de URLs
- `src/modules/billing/pricing/gcp-pricing.service.ts` — substituído `fetch` por `node:https`; paginação completa (`nextPageToken` até 5 páginas); tabela `MACHINE_FAMILY_TERMS` com ~25 famílias de máquina; `resolveServiceId` com fallback fuzzy; múltiplos termos candidatos por busca; adicionados Memorystore, AlloyDB, Cloud Armor ao `GCP_SERVICE_IDS`
- `.env` — adicionado `ANTHROPIC_API_KEY` e `GCP_API_KEY`

**Descrição:**

**Pipeline completo (6 etapas):**
1. Frontend parseia e envia `ParsedBilling` via `POST /api/billing/analyze/stream`
2. Claude mapeia serviços AWS → GCP/Azure/OCI com prompt caching no system prompt
3. APIs públicas buscam preços reais em paralelo
4. Classificação por confiança (`verified` / `partial` / `not_found` / `no_api`)
5. Claude gera recomendação com base nos dados verificados
6. Cálculo de payback e ROI (12/24/36 meses)

**SSE via POST:**
O `@Sse` do NestJS cria endpoint GET — incompatível com body. Solução: `@Post` + `@Res()` manual escrevendo `data: {...}\n\n` no stream. O frontend consome com `fetch` + `ReadableStream`.

**Eventos SSE emitidos:**
| step | quando |
|------|--------|
| `mapping` | antes e depois do Claude mapear |
| `pricing` | antes de buscar preços |
| `classification` | após preços + classificação |
| `recommendation` | antes e depois do Claude recomendar |
| `done` | resultado completo |
| `error` | qualquer erro no pipeline |

**Melhorias de cobertura (0% → 67%):**
- Azure: `node:https` resolve `fetch failed` no Windows/Node; 3 tentativas com fallback `contains`
- GCP: paginação completa; tabela de termos por família de máquina; múltiplos candidatos de busca
- Prompt de mapeamento com lista fechada de valores aceitos para `gcp.service` e `azure.service`, e tabela de equivalência de regiões AWS ↔ GCP ↔ Azure
- Campo `targetRegion` em `ParsedBilling` instrui Claude a usar a região geográfica correta

**Observações:**
- Cobertura atual: **67%** (4/5 serviços verificados em bill real de $104k/mês)
- AWS WAF e serviços de storage ainda com match parcial — Azure WAF_v2 e Blob usam metadados diferentes (LCU/GB em vez de SKU de VM)
- `estimatedMonthly` por enquanto é `preço_unitário × 730h` — não reflete múltiplas instâncias; resolver via parse de `quantity` no frontend
- `migrationCost` é hardcoded como `totalCost × 3` (heurística); próxima melhoria: parâmetro configurável
- Prompt caching ativo no system prompt do Claude (reduz custo em ~90% nas chamadas repetidas)

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
Endpoint separado de `PATCH /users/me` para troca de senha, exigindo validação da senha atual antes de aplicar a nova. Retorna 401 se a senha atual estiver incorreta.

**Observações:**
- Diferença intencional em relação ao `reset-password`: aquele invalida todos os refresh tokens (fluxo de recuperação), este não (fluxo de perfil logado).

---

## [2026-05-21] — Auth: Endpoint de Reset de Senha

**Objetivo:** Implementar `POST /auth/reset-password` para completar o fluxo de recuperação de senha.

**Arquivos criados:**
- `src/modules/auth/dto/reset-password.dto.ts` — `{ token: string, newPassword (min 8) }`

**Arquivos alterados:**
- `src/modules/auth/auth.service.ts` — adicionado `resetPassword()`
- `src/modules/auth/auth.controller.ts` — adicionado `POST /auth/reset-password`
- `AI/MODULES/AUTH.md` — documentação atualizada

---

## [2026-05-21] — Auth: Endpoint de Esqueci Senha

**Objetivo:** Criar endpoint de recuperação de senha no módulo de autenticação.

**Arquivos criados:**
- `src/modules/auth/dto/forgot-password.dto.ts`

**Arquivos alterados:**
- `src/modules/auth/auth.controller.ts` — adicionado `POST /auth/forgot-password`
- `src/modules/auth/auth.service.ts` — adicionado `forgotPassword()`

---

## [2026-05-21] — Billing Pipeline V2: Etapas 3 e 4 (APIs de Preços)

**Objetivo:** Implementar clientes das APIs públicas de preços e classificação de confiança.

**Arquivos criados:**
- `src/modules/billing/types/pipeline.types.ts`
- `src/modules/billing/pricing/azure-pricing.service.ts`
- `src/modules/billing/pricing/aws-pricing.service.ts`
- `src/modules/billing/pricing/gcp-pricing.service.ts`
- `src/modules/billing/pricing/pricing-orchestrator.service.ts`
- `AI/MODULES/BILLING.md`

---

## [2026-05-21] — Setup Inicial do Backend

**Objetivo:** Criar o backend NestJS com Auth + Users como base.

**Arquivos criados:** todo o scaffold inicial (ver entrada completa abaixo).

**Descrição:** Projeto NestJS com Auth JWT completo, Users, Prisma 7, PostgreSQL.
