# Módulo: Users

> Última atualização: 2026-05-21
> Status: Implementado e funcional

---

## Responsabilidade

Perfil do usuário autenticado: consulta, atualização de dados e troca de senha.

---

## Arquivos

| Arquivo | Função |
|---------|--------|
| `users.module.ts` | Registra UsersService e UsersController |
| `users.service.ts` | Lógica de negócio: perfil, atualização, troca de senha |
| `users.controller.ts` | 3 endpoints, todos protegidos por `JwtAuthGuard` |
| `dto/update-user.dto.ts` | `{ name?, password? }` — campos opcionais |
| `dto/change-password.dto.ts` | `{ currentPassword, newPassword (min 8) }` |

---

## Endpoints

Todos exigem `Authorization: Bearer <accessToken>`. Prefixo global: `/api`.

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| GET | `/users/me` | — | Retorna perfil sem `passwordHash` |
| PATCH | `/users/me` | `{ name?, password? }` | Atualiza nome ou senha (sem validar senha atual) |
| PATCH | `/users/me/password` | `{ currentPassword, newPassword }` | Troca senha com validação da senha atual |

---

## Fluxo de Troca de Senha (`PATCH /users/me/password`)

```
→ JWT validado pelo JwtAuthGuard (401 se token inválido/ausente)
→ UsersService.changePassword(userId, dto)
  → busca usuário no banco
  → bcrypt.compare(currentPassword, passwordHash)
  → 401 "Senha atual incorreta" se não bater
  → bcrypt.hash(newPassword, 10)
  → atualiza passwordHash no banco
  → retorna { message: 'Senha alterada com sucesso.' }
```

**Diferença intencional vs `POST /auth/reset-password`:**
- `/reset-password` — fluxo de recuperação (usuário esqueceu a senha): invalida todos os refresh tokens
- `/users/me/password` — fluxo de perfil (usuário logado trocando a senha): **não** invalida refresh tokens

---

## Próximos Passos Sugeridos

- [ ] `DELETE /users/me` — exclusão de conta com confirmação de senha
- [ ] `GET /users/:id` — consulta de perfil público (necessário para features sociais)
- [ ] Guard de roles para endpoints administrativos de listagem de usuários