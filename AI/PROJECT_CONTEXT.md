# TransformCloud Backend — Contexto Completo

> Gerado em: 2026-05-21
> Objetivo: Referência para agentes de IA e desenvolvedores antes de qualquer mudança no backend.

---

## O que é este backend?

API REST em NestJS que serve o frontend Next.js do TransformCloud. Roda na porta **3001** enquanto o Next.js roda na **3000**.

**Responsabilidades atuais:** autenticação JWT, cadastro e perfil de usuários.  
**Responsabilidades futuras:** pipeline de análise de billing (V2), receitas de migração, observabilidade de infra, credenciais de provedores cloud por usuário.

---

## Stack Técnica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Framework | NestJS | 11.x |
| Linguagem | TypeScript | 5.x |
| ORM | Prisma | 7.8.0 |
| Banco | PostgreSQL | 16 |
| Auth | Passport + JWT | - |
| Validação | class-validator + class-transformer | - |
| Config | @nestjs/config | - |

**Atenção Prisma 7:** Breaking changes em relação ao Prisma 5/6.
- `url` foi removido do `schema.prisma` — a URL de conexão fica em `prisma.config.ts`
- `datasourceUrl` e `datasources` foram removidos do construtor do `PrismaClient`
- Prisma 7 exige adapter explícito no construtor — usar `@prisma/adapter-pg` com `new PrismaPg({ connectionString })`
- O import deve ser feito de `@prisma/client` (não do caminho relativo `.prisma/client`)

---

## Estrutura de Arquivos

```
backend/
├── prisma/
│   └── schema.prisma              # Models: User, RefreshToken, CloudIntegration, BillingAnalysis
├── prisma.config.ts               # Configuração Prisma 7 (lê DATABASE_URL do .env)
├── src/
│   ├── main.ts                    # Bootstrap: porta 3001, CORS :3000, ValidationPipe global
│   ├── app.module.ts              # Raiz: registra todos os módulos
│   ├── prisma/
│   │   ├── prisma.service.ts      # PrismaClient como serviço NestJS (Global)
│   │   └── prisma.module.ts       # Módulo global — não precisa importar em outros módulos
│   └── modules/
│       ├── auth/                  # Autenticação JWT completa
│       │   ├── auth.module.ts
│       │   ├── auth.service.ts
│       │   ├── auth.controller.ts
│       │   ├── dto/
│       │   │   ├── register.dto.ts
│       │   │   ├── login.dto.ts
│       │   │   ├── refresh-token.dto.ts
│       │   │   └── forgot-password.dto.ts
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts
│       │   └── guards/
│       │       └── jwt-auth.guard.ts
│       ├── users/                 # Perfil de usuário (protegido por JWT)
│       │   ├── users.module.ts
│       │   ├── users.service.ts
│       │   ├── users.controller.ts
│       │   └── dto/
│       │       ├── update-user.dto.ts
│       │       └── change-password.dto.ts
│       ├── billing/               # Pipeline V2 — Etapas 3+4 implementadas (ver MODULES/BILLING.md)
│       │   ├── billing.module.ts
│       │   ├── types/
│       │   │   └── pipeline.types.ts        # Tipos das 6 etapas do pipeline
│       │   └── pricing/
│       │       ├── azure-pricing.service.ts
│       │       ├── aws-pricing.service.ts
│       │       ├── gcp-pricing.service.ts
│       │       └── pricing-orchestrator.service.ts
│       ├── migrations/            # SCAFFOLD — Receitas de migração
│       │   └── migrations.module.ts
│       ├── observability/         # SCAFFOLD — Métricas e alertas de infra
│       │   └── observability.module.ts
│       └── integrations/          # SCAFFOLD — Credenciais AWS/GCP/Azure/OCI por usuário
│           └── integrations.module.ts
├── AI/                            # ← Esta pasta
│   ├── PROJECT_CONTEXT.md         # Este arquivo
│   ├── CHANGES.md                 # Log de mudanças por sessão
│   └── MODULES/                   # Contexto por módulo (criado quando implementado)
│       ├── AUTH.md
│       ├── USERS.md
│       └── BILLING.md
├── .env                           # DATABASE_URL, JWT_SECRET, etc (não commitado)
├── .env.example                   # Modelo de variáveis de ambiente
└── docker-compose.yml             # PostgreSQL 16 (na raiz do monorepo)
```

---

## Variáveis de Ambiente (`.env`)

```env
DATABASE_URL="postgresql://postgres:<senha>@localhost:5432/transformcloud"
JWT_SECRET="segredo-do-access-token"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="segredo-do-refresh-token"
JWT_REFRESH_EXPIRES_IN="7d"
JWT_RESET_SECRET="segredo-do-token-de-reset"   # opcional (fallback para JWT_SECRET)
JWT_RESET_EXPIRES_IN="15m"
PORT=3001
GCP_API_KEY=""         # Chave de API pública do Google Cloud (Cloud Billing API) — sem OAuth
```

---

## Database Schema (Prisma)

### `User`
| Campo | Tipo | Obs |
|-------|------|-----|
| id | String (cuid) | PK |
| email | String | único |
| name | String | |
| passwordHash | String | bcrypt, salt 10 |
| role | Role | USER \| ADMIN |
| createdAt / updatedAt | DateTime | |

### `RefreshToken`
Tokens de refresh armazenados no banco. Invalidados no logout ou ao usar (rotação automática).

### `CloudIntegration`
Credenciais de provedores cloud por usuário (chave criptografada). A ser implementada no módulo `integrations`.

### `BillingAnalysis`
Histórico de análises de billing por usuário. A ser implementada no módulo `billing`.

---

## Endpoints Implementados

Prefixo global: `/api`

### Auth — `/api/auth`
| Método | Rota | Body | Auth | Descrição |
|--------|------|------|------|-----------|
| POST | `/register` | `{ email, name, password }` | Não | Cadastro + retorna tokens |
| POST | `/login` | `{ email, password }` | Não | Login + retorna tokens |
| POST | `/refresh` | `{ refreshToken }` | Não | Renova tokens (rotação) |
| POST | `/logout` | `{ refreshToken }` | Não | Invalida refresh token |
| POST | `/forgot-password` | `{ email }` | Não | Inicia recuperação com resposta neutra e token temporário |
| POST | `/reset-password` | `{ token, newPassword }` | Não | Redefine senha via token de reset (invalida refresh tokens) |

**Resposta de tokens:**
```json
{ "accessToken": "...", "refreshToken": "..." }
```

### Users — `/api/users`
| Método | Rota | Body | Auth | Descrição |
|--------|------|------|------|-----------|
| GET | `/me` | — | JWT | Retorna perfil sem passwordHash |
| PATCH | `/me` | `{ name?, password? }` | JWT | Atualiza nome ou senha |
| PATCH | `/me/password` | `{ currentPassword, newPassword }` | JWT | Troca senha com validação da senha atual |

**Header obrigatório nos endpoints protegidos:**
```
Authorization: Bearer <accessToken>
```

---

## Status dos Módulos

| Módulo | Status | Próximos passos |
|--------|--------|-----------------|
| `billing` | ⚙️ Em andamento — Etapas 3+4 implementadas | Parser (Et.1), Claude mapping (Et.2), Claude recomendação (Et.5), payback (Et.6), controller |
| `migrations` | 🔲 Scaffold vazio | Receitas de migração passo-a-passo, histórico por usuário |
| `observability` | 🔲 Scaffold vazio | Métricas de infra, alertas, integrações de monitoramento |
| `integrations` | 🔲 Scaffold vazio | CRUD de credenciais AWS/GCP/Azure/OCI criptografadas por usuário |

---

## Como Rodar Localmente

```bash
# 1. Instalar dependências
cd backend && npm install

# 2. Criar .env (copiar de .env.example e ajustar senha)
cp .env.example .env

# 3. Subir banco PostgreSQL (opção Docker)
docker-compose up -d   # na raiz do monorepo

# 4. Rodar migrations
npx prisma migrate dev --name init

# 5. Iniciar em modo dev
npm run start:dev
```

Backend disponível em `http://localhost:3001/api`

---

## Decisões de Arquitetura

1. **PrismaModule é `@Global()`** — não precisa importar em cada módulo, só injetar `PrismaService`.
2. **Refresh token com rotação** — cada uso do refresh gera um par novo e invalida o anterior.
3. **`passwordHash` nunca retornado** — o método `profile()` destrói o campo antes de retornar.
4. **Prisma 7 sem `url` no schema** — a URL fica exclusivamente em `prisma.config.ts` via `datasource.url`.
5. **`@prisma/adapter-pg` no construtor do `PrismaService`** — Prisma 7 não lê `DATABASE_URL` automaticamente em runtime; a URL precisa ser passada via adapter (`new PrismaPg({ connectionString: process.env.DATABASE_URL })`). O import é feito de `@prisma/client` normalmente.
