# Banco de dados

PostgreSQL + Prisma. Schema completo em `apps/api/prisma/schema.prisma`.

## Modelos (Fase 01)

- **Tenant** — `slug` e `document` únicos; `status` (`TRIAL` no cadastro,
  `ACTIVE`/`SUSPENDED`/`CANCELLED` depois).
- **Branch** — pertence a um Tenant; `(tenantId, code)` único. O cadastro
  cria automaticamente uma branch com `code = "MATRIZ"`.
- **User** — `email` **globalmente** único na plataforma (não só por tenant).
  Isso foi uma decisão deliberada: o login (`POST /auth/login`) recebe apenas
  e-mail e senha, sem seletor de tenant/slug, então a busca por e-mail
  precisa ser inequívoca. Um mesmo e-mail não pode logar em dois tenants
  diferentes — se essa necessidade surgir (uma pessoa que gerencia dois
  restaurantes), tratar em fase futura (provavelmente com seleção de tenant
  pós-login, não com e-mail duplicado).
- **Role / Permission / RolePermission** — catálogo global de papéis do
  sistema (enum `RoleName`) e permissões (`key` livre, ex. `"users.read"`).
- **UserRole** — associação usuário↔papel, com `tenantId` explícito (mesmo
  que hoje um usuário só pertença a um tenant) para já suportar, sem migração
  de schema, um usuário atuando em mais de um tenant no futuro.
- **UserBranch** — acesso do usuário a unidades específicas.
- **RefreshToken** — nunca guarda o token em texto puro, apenas
  `sha256(token)`; suporta rotação (`replacedBy`) e revogação (`revokedAt`).
- **AuditLog** — `tenantId`/`userId` opcionais (podem ficar `null` se a
  entidade referenciada for removida — `onDelete: SetNull`), `beforeData`/
  `afterData` em `Json`.

## Índices e constraints relevantes

- `tenants.slug`, `tenants.document`, `users.email`, `refresh_tokens.tokenHash`
  → `@unique`
- `branches (tenantId, code)`, `user_roles (userId, roleId, tenantId)`,
  `user_branches (userId, branchId)`, `role_permissions (roleId, permissionId)`
  → `@@unique` compostos
- `users.tenantId`, `branches.tenantId`, `user_roles.tenantId`,
  `audit_logs (tenantId, createdAt)`, `audit_logs (entity, entityId)` → `@@index`

## Category / Product (MVP fatia 01 — cardápio administrativo)

- **Category** — escopada por `tenantId`; `active`/`displayOrder` para
  controle de exibição. Não pode ser excluída se tiver produtos vinculados
  (`ProductsService` valida antes; a FK `onDelete: Restrict` é a rede de
  segurança no banco caso essa checagem seja contornada).
- **Product** — escopada por `tenantId` **e** por `categoryId`. Preço
  guardado como `priceCents` (`Int`, centavos) — nunca `Float` — para evitar
  erro de arredondamento monetário; a API converte para/de reais na borda
  (`toCents`/`fromCents` em `ProductsService`). Criar ou editar um produto
  sempre revalida que `categoryId` pertence ao mesmo tenant do usuário
  autenticado (reutilizando `CategoriesService.findOneForTenant`), o que
  automaticamente barra um produto apontando para categoria de outro tenant.

## Order / OrderItem (existem desde a fatia 04)

`Order` e `OrderItem` foram adicionados na fatia 04 (checkout) e ganharam o
campo `source` (`OrderSource`: `ONLINE`/`COUNTER`) na fatia 07 (PDV) para
distinguir pedidos feitos pelo cardápio público dos criados no balcão.
`customerName`/`customerPhone` são opcionais (`String?`) desde a fatia 07 —
uma venda de balcão pode não ter identificação do cliente; pedidos online
continuam sempre preenchendo os dois (obrigatório no DTO de checkout). Ver
`docs/PROJECT_STATUS.md` "Fatia 04" e "Fatia 07" para as regras completas.

## O que NÃO existe ainda (proposital)

Payment, CashRegister, Inventory, Customer, Delivery, Table, FiscalDocument
— chegam nas fases posteriores.

## Seed

`prisma/seed.ts` cria **apenas** os 8 `Role`s do enum, o catálogo de
`Permission`s e o vínculo `RolePermission` de cada papel. Nenhum tenant,
usuário ou dado de negócio fictício é criado pelo seed — cadastros reais
acontecem via `POST /auth/register`.
