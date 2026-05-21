# Módulo: Auth

> Última atualização: 2026-05-21
> Status: Implementado e funcional

---

## Responsabilidade

Cadastro, login, recuperação de senha, renovação e invalidação de tokens JWT.

---

## Arquivos

| Arquivo | Função |
|---------|--------|
| `auth.module.ts` | Registra JwtModule (async via ConfigService), PassportModule, JwtStrategy |
| `auth.service.ts` | Lógica de negócio: hash de senha, geração/rotação de tokens, persistência de refresh tokens |
| `auth.controller.ts` | 6 endpoints: register, login, refresh, logout, forgot-password, reset-password |
| `dto/register.dto.ts` | `{ email, name, password (min 8) }` |
| `dto/login.dto.ts` | `{ email, password }` |
| `dto/refresh-token.dto.ts` | `{ refreshToken }` |
| `dto/forgot-password.dto.ts` | `{ email }` |
| `dto/reset-password.dto.ts` | `{ token, newPassword (min 8) }` |
| `strategies/jwt.strategy.ts` | Extrai e valida Bearer token; injeta `{ sub, email, role }` em `req.user` |
| `guards/jwt-auth.guard.ts` | `@UseGuards(JwtAuthGuard)` — protege rotas com JWT |

---

## Fluxo de Autenticação

```
POST /api/auth/register
  → valida DTO
  → UsersService.create() — verifica email único, faz hash bcrypt
  → generateTokens() — cria accessToken (15m) + refreshToken (7d)
  → persiste refreshToken no banco (tabela refresh_tokens)
  → retorna { accessToken, refreshToken }

POST /api/auth/login
  → busca usuário por email
  → bcrypt.compare(senha, hash)
  → generateTokens() igual ao register

POST /api/auth/refresh
  → busca refreshToken no banco
  → verifica expiresAt
  → deleta o token usado (rotação)
  → gera novo par de tokens

POST /api/auth/logout
  → deleta refreshToken do banco

POST /api/auth/forgot-password
  → recebe email
  → retorna mensagem neutra (sem vazar se usuário existe)
  → se usuário existir: gera JWT temporário com `purpose: password-reset` (15m por padrão)
  → loga token no console (integração com e-mail pendente)

POST /api/auth/reset-password
  → recebe { token, newPassword }
  → verifica JWT com JWT_RESET_SECRET (400 se inválido/expirado)
  → verifica payload.purpose === 'password-reset' (400 se diferente)
  → atualiza passwordHash no banco (bcrypt salt 10)
  → deleta todos os refresh tokens do usuário (força novo login)
  → retorna { message: 'Senha redefinida com sucesso.' }
```

---

## Variáveis de Ambiente Necessárias

```env
JWT_SECRET=           # segredo do access token
JWT_EXPIRES_IN=15m    # duração do access token
JWT_REFRESH_SECRET=   # segredo do refresh token (diferente do access)
JWT_REFRESH_EXPIRES_IN=7d
JWT_RESET_SECRET=     # opcional; fallback para JWT_SECRET
JWT_RESET_EXPIRES_IN=15m
```

---

## Como Usar em Outros Módulos

Para proteger um endpoint:

```typescript
import { UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Get('exemplo')
exemplo(@Request() req: { user: { sub: string; email: string; role: string } }) {
  return req.user.sub; // ID do usuário logado
}
```

---

## Próximos Passos Sugeridos

- [ ] Rate limiting em `/login`, `/register`, `/forgot-password` (pacote `@nestjs/throttler`)
- [ ] Integração com serviço de e-mail para envio do link de reset (ex: Resend, SendGrid)
- [ ] Persistência do reset token no banco para permitir invalidação antes de expirar
- [ ] Rota `POST /auth/revoke-all` para invalidar todos os refresh tokens do usuário
- [ ] Guard de roles (`@Roles('ADMIN')`) para rotas administrativas
