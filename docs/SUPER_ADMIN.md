# Super Admin: administração da plataforma

`/super-admin` é a área de quem administra a **plataforma inteira** (todos os restaurantes). Não é o
painel do restaurante: o OWNER administra só o próprio restaurante e não entra aqui.

MVP (2026-10-28): visão geral, lista paginada com busca, detalhe, criação, suspensão e reativação de
restaurantes. Fora do MVP: cobrança, planos, vencimentos, faturas, métricas financeiras, exclusão
definitiva, edição de dados de outros restaurantes e "entrar como cliente".

## Quem é administrador da plataforma

Uma tabela própria, `platform_admins` (migration `20261028180000_platform_admins`), com uma linha por
conta (`userId` único). **Não é um papel**: papéis vivem dentro de um restaurante
(`user_roles.tenantId`), e OWNER/ADMIN não podem alcançar outros restaurantes.

- A conta continua sendo uma conta comum, de algum restaurante, e entra pelo login normal. Recomenda-se
  um restaurante próprio da equipe (ex.: "Equipe Plataforma"): suspender o restaurante da conta tiraria o
  acesso dela, e por isso o painel recusa suspender o restaurante da própria conta.
- Nenhuma rota grava `platform_admins`. Só o comando local `platform-admin:grant` / `:revoke`.
- Nada de e-mail ou senha no código, nada em variável `NEXT_PUBLIC_*`.

## Como as rotas são protegidas

Todas as rotas que atravessam restaurantes ficam em `/v1/platform/*`
(`apps/api/src/modules/platform`, módulo que não exporta nada) e passam pelo `PlatformAdminGuard`:

| Quem | Resposta |
| --- | --- |
| anônimo | `401` (guard JWT global) |
| qualquer conta de restaurante: VIEWER, KITCHEN, WAITER, CASHIER, MANAGER, ADMIN, **OWNER** | `403 PLATFORM_ADMIN_REQUIRED` |
| conta com linha em `platform_admins` e status `ACTIVE` | permitido |

O guard lê a tabela **a cada requisição** (não confia no token): revogar vale na próxima chamada, com
o mesmo token. O `tenantId` do token nunca escolhe dados em `/platform`, e nenhuma rota de tenant
mudou: fora de `/platform` o token do administrador continua preso ao restaurante dele.

O web esconde o atalho e mostra "Acesso negado" em `/super-admin` para quem não é administrador (o
`/auth/me` informa `isPlatformAdmin`), sem disparar nenhuma chamada a `/platform`. Mas quem protege é a
API.

## Endpoints

| Método e rota | O que faz |
| --- | --- |
| `GET /v1/platform/overview` | total de restaurantes e quantos em cada status (`ACTIVE`, `TRIAL`, `SUSPENDED`, `CANCELLED`) |
| `GET /v1/platform/tenants?search=&page=&pageSize=` | lista paginada (20 por página, máximo 50), mais novos primeiro; busca por nome, slug ou e-mail do OWNER, sem diferenciar maiúsculas |
| `GET /v1/platform/tenants/:id` | detalhe: nome, razão social, documento **mascarado**, slug, status, fuso, unidades, OWNERs, nº de usuários, delivery da unidade principal, histórico da plataforma. Nunca hash de senha, tokens ou segredos |
| `POST /v1/platform/tenants` | cria pelo `TenantProvisioningService` (o mesmo do CLI): TRIAL, unidade `MATRIZ` com delivery desligado, OWNER. `409 SLUG_ALREADY_EXISTS` / `DOCUMENT_ALREADY_EXISTS` / `EMAIL_ALREADY_EXISTS` indicam o campo |
| `POST /v1/platform/tenants/:id/suspend` `{ reason }` | `ACTIVE`/`TRIAL` → `SUSPENDED`, motivo obrigatório (5 a 500 caracteres) |
| `POST /v1/platform/tenants/:id/reactivate` | `SUSPENDED` → o status de antes da suspensão (TRIAL volta TRIAL) |

## Suspensão

Reutiliza o status que a API inteira já obedece (`isTenantBlocked`: `SUSPENDED` e `CANCELLED`). Ao
suspender:

- login → `403 TENANT_NOT_ACTIVE` ("Este restaurante está suspenso."); refresh → `401`;
- cardápio público, cotação, pedido público e confirmação → `404`;
- **sessões já abertas caem na hora**: a suspensão grava `auth:revoked:tenant:<id>` no Redis e todo
  access token das contas do restaurante emitido até ali responde `401` (docs/authentication.md).
  Antes do Super Admin esse era um buraco: o token já emitido valia até expirar (15 min).

Nada é apagado nem editado: usuários, pedidos, estoque, caixa e histórico ficam como estavam. A
reativação devolve o status anterior e o acesso, sem tocar em dado de negócio.

Limite conhecido: se o Redis estiver fora no instante da suspensão, a marca não é gravada e os tokens
já emitidos valem até expirar (no máximo 15 min). Login e refresh continuam recusados pelo banco. É a
mesma decisão de "falha aberta" do logout.

## Auditoria

| Ação | Quem (`userId`) | Restaurante (`tenantId`) | Dados |
| --- | --- | --- | --- |
| `TENANT_PROVISIONED` | o OWNER criado | o novo | slug, e-mail do OWNER, `provisionedBy` |
| `PLATFORM_TENANT_CREATED` | o administrador | o novo | nome, slug, e-mail do OWNER |
| `PLATFORM_TENANT_SUSPENDED` | o administrador | o suspenso | status anterior, **motivo** |
| `PLATFORM_TENANT_REACTIVATED` | o administrador | o reativado | status restaurado |
| `PLATFORM_ADMIN_GRANTED` / `_REVOKED` | a conta | o restaurante da conta | e-mail, operador do CLI (`usuário@máquina`) |

Data, IP e user-agent em todas. A senha nunca entra em auditoria, log ou resposta. As entradas da
criação e da suspensão/reativação são gravadas na mesma transação da mudança.

## Primeiro administrador (bootstrap)

A conta precisa **já existir** (o comando não cria contas). Para a primeira vez, crie o restaurante da
equipe com `pnpm tenant:provision` (docs/PROVISIONING.md) e depois, na raiz do repositório:

```bash
pnpm platform-admin:grant -- --email voce@suaempresa.com.br
```

O comando mostra o banco alvo (host, database, ambiente), a conta (nome, e-mail, situação,
restaurante, papéis) e pede `Digite CONCEDER para continuar:`. Qualquer outra resposta cancela.
Para revogar:

```bash
pnpm platform-admin:revoke -- --email voce@suaempresa.com.br
```

(pede `REVOGAR`). Automação: `--confirm-database <nome-do-banco>` no lugar da pergunta.

O banco é o mesmo critério do `tenant:provision`: `DATABASE_URL` do ambiente, senão `apps/api/.env`.
PowerShell, para outro banco: `$env:DATABASE_URL = '...'` antes e `Remove-Item Env:DATABASE_URL`
depois. Na stack Docker:
`docker compose -f deploy/compose.yml exec api node dist/src/cli/platform-admin.js grant --email ...`.

Códigos de saída: 0 feito (ou nada a fazer: já era / não era administrador); 1 recusado (cancelado,
conta inexistente ou inativa); 2 comando ou ambiente errado.

## Migration 20: preflight antes do DEV

A migration `20261028180000_platform_admins` é **aditiva**: uma tabela nova e vazia, um índice
único e uma FK para `users` (`ON DELETE CASCADE`). Nenhuma tabela, coluna ou linha existente muda. Foi
testada só em bancos descartáveis (20/20 aplicadas, `prisma migrate diff` sem drift). **Não foi
aplicada no DEV.**

**Importante:** este código consulta `platform_admins` no `/auth/me`. Rodar a API nova num banco
sem a migration 20 quebra o `/auth/me` (e o painel) de todo mundo. A ordem é sempre migration
primeiro, código depois (`node deploy/migrate.js release` já faz assim).

Plano de preflight (o mesmo roteiro da migration 19):

1. **Identificar o alvo, só leitura:** container `restaurant-saas-postgres`, `localhost:5432`,
   database `restaurant_saas`, `system_identifier` conferido; `default_transaction_read_only=on`;
   `_prisma_migrations` com 19 aplicadas e nenhuma pendente/falha; contagem de tenants, usuários,
   pedidos.
2. **Backup novo:** `pg_dump -Fc` →
   `restaurant-saas-backups/dev/restaurant_saas_dev_<DATA_HORA>_antes_migration_20.dump`, com sha256
   e teste de restauração numa cópia.
3. **Ensaio numa cópia do DEV** (restaurada do backup num Postgres descartável): `prisma migrate deploy`
   → 20/20; `prisma migrate diff --from-schema-datasource --to-schema-datamodel --exit-code` → sem
   drift; `platform_admins` vazia, índice `platform_admins_userId_key` e FK presentes; impressão digital
   das tabelas existentes (contagens e checksums) idêntica antes e depois.
4. **Smoke na cópia:** API nova contra a cópia; login de uma conta do tenant de teste
   (`91f9fcea…`), `/auth/me` com `isPlatformAdmin: false`, `/platform/*` → `403`; `platform-admin:grant`
   numa conta de teste da cópia, `/super-admin` abre, lista paginada com os ~2063 tenants históricos,
   busca, detalhe.
5. **Relatório "PREFLIGHT MIGRATION 20: APROVADO/REPROVADO"** e só então, com autorização,
   aplicar no DEV.

Rollback: restaurar o backup do passo 2. Como a mudança é só uma tabela nova, a alternativa manual
seria `DROP TABLE platform_admins` e remover a linha da migration em `_prisma_migrations`, mas só com
autorização explícita.

## Testes

- API, unitários: `platform-admin.guard.spec.ts`, `platform-tenants.service.spec.ts` (máscara do
  documento), `session-revocation.service.spec.ts` (marca por tenant), `src/cli/platform-admin.cli.spec.ts`.
- API, e2e: `test/platform-admin.e2e-spec.ts` (401/403 por papel, listagem, paginação, busca, criação,
  duplicidades, suspensão, reativação, isolamento das rotas de tenant) e
  `test/platform-admin-cli.e2e-spec.ts` (o comando rodado de verdade).
- Web: `lib/platform-logic.test.ts` e `app/super-admin/super-admin.test.ts` (acesso negado, menu,
  visão geral, lista, paginação, busca, formulário, exemplos, senha, slug sugerido, duplicidade,
  suspensão e reativação).
