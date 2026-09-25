# TransformCloud Backend — Contexto do projeto

> Atualizado em: 2026-09-25

## Objetivo

API NestJS do TransformCloud, executada por padrão em `http://localhost:3001/api`. Ela oferece autenticação, perfil de usuário e análise multi-cloud de billing.

A fonte de verdade de serviços, equivalências e preços é o catálogo local versionado. A IA é opcional e participa somente da redação da explicação final.

## Stack

| Camada | Tecnologia |
|---|---|
| API | NestJS 11 + TypeScript |
| Banco | PostgreSQL 16 |
| ORM | Prisma 7 com `@prisma/adapter-pg` |
| Auth | Passport, JWT e bcrypt |
| Catálogo | modelos Prisma + importador JSON |
| IA opcional | Anthropic SDK |

No Prisma 7, a URL do banco fica em `prisma.config.ts`, não no bloco `datasource` de `schema.prisma`.

## Módulos

| Módulo | Responsabilidade | Status |
|---|---|---|
| `auth` | cadastro, login, refresh, logout e recuperação de senha | completo |
| `users` | perfil e troca de senha | completo |
| `catalog` | serviços, ofertas, medidores, preços, overrides e importação | compute implementado |
| `billing` | pipeline SSE de matching, preço, ranking e payback | compute validado |
| `integrations` | integrações futuras | scaffold |
| `migrations` | automação de migração futura | scaffold |
| `observability` | telemetria futura | scaffold |

## Estrutura relevante

```text
src/
├── commands/import-catalog.ts
├── modules/catalog/
│   ├── catalog-import.service.ts
│   ├── catalog-pricing.service.ts
│   ├── catalog.repository.ts
│   └── catalog.types.ts
└── modules/billing/
    ├── billing.controller.ts
    ├── pipeline.service.ts
    ├── mapping/deterministic-mapping.service.ts
    ├── pricing/pricing-orchestrator.service.ts
    ├── ai/claude.service.ts
    └── types/pipeline.types.ts
```

## Endpoints

Prefixo global: `/api`.

| Método | Endpoint | Descrição |
|---|---|---|
| POST | `/auth/register` | cadastro e tokens |
| POST | `/auth/login` | autenticação |
| POST | `/auth/refresh` | rotação de tokens |
| POST | `/auth/logout` | invalidação do refresh token |
| POST | `/auth/forgot-password` | início da recuperação |
| POST | `/auth/reset-password` | redefinição por token |
| GET | `/users/me` | perfil autenticado |
| PATCH | `/users/me` | atualização de nome |
| PATCH | `/users/me/password` | troca de senha |
| POST | `/billing/analyze/stream` | análise de billing via SSE |

## Billing atual

O contrato preferencial usa `lineItems` com serviço, SKU/medidor, região, quantidade, unidade, custo e atributos técnicos. `topServices` permanece aceito durante a migração do frontend.

O pipeline:

1. normaliza as linhas recebidas;
2. resolve a oferta de origem no catálogo;
3. busca equivalentes por região e capacidade;
4. calcula os preços locais vigentes;
5. classifica a cobertura;
6. escolhe o destino por código;
7. permite apenas a redação opcional pela IA;
8. calcula payback e ROI.

Consulte `AI/MODULES/BILLING.md` e `AI/MODULES/CATALOG.md` para contratos e testes.

## Variáveis de ambiente

```env
DATABASE_URL="postgresql://postgres:<senha>@localhost:5432/transformcloud"
JWT_SECRET="..."
JWT_EXPIRES_IN="15m"
JWT_REFRESH_SECRET="..."
JWT_REFRESH_EXPIRES_IN="7d"
PORT=3001

# Opcional: somente para melhorar a redação da recomendação
ANTHROPIC_API_KEY=""
```

As antigas chaves de APIs públicas de preço não são necessárias para o pipeline novo; os valores são importados no catálogo.

## Execução local

```bash
npm install
npx prisma migrate dev
npm run catalog:import -- test/fixtures/catalog/aws-compute-demo.json
npm run catalog:import -- test/fixtures/catalog/gcp-compute-demo.json
npm run catalog:import -- test/fixtures/catalog/azure-compute-demo.json
npm run start:dev
```

O teste ponta a ponta está descrito em `AI/MODULES/CATALOG.md#teste-local-reproduzível`.

## Próximas etapas

1. Adaptadores oficiais de catálogo AWS, GCP, Azure e OCI.
2. Matchers para banco, storage, cache, Kubernetes e rede.
3. Fluxo administrativo para revisar `MappingOverride`.
4. Política de atualização e expiração dos snapshots.
5. Testes de integração do importador com PostgreSQL isolado.
