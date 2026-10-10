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

## Modelos adicionados depois da Fase 01

Existem no schema atual (17 migrations em `prisma/migrations`, da `20260928001733_initial_mvp_schema` à `20261010230000_cash_sale_refund`):

- **Pedidos:** `Order` (com `branchId`, `source`, `idempotencyKey` único por tenant) e `OrderItem`, com snapshots de nome e preço.
- **Pagamento:** `Payment` (`orderId` único, `provider` só `INTERNAL`).
- **Caixa:** `CashRegisterSession` e `CashMovement`. Movimentos são só de inclusão (trigger). `orderId` único liga a venda (`SALE`) ao pedido; `refundedOrderId` único liga o estorno de venda (`SALE_REFUND`) ao pedido cancelado, e um CHECK garante que só o estorno tem essa coluna preenchida.
- **Salão:** `DiningTable`, `Tab`, `TabItem`.
- **Estoque:** `InventoryItem`, `InventoryBalance`, `StockMovement`, `ProductRecipe`, `ProductRecipeItem`, `InventoryCount`, `InventoryCountItem`.
- **Compras:** `Supplier`, `Purchase`, `PurchaseItem` e `PurchaseSequence` (migration `20260930100000_purchases`). `Purchase` é único por `(tenantId, purchaseNumber)`, tem índices por unidade, data e status, e CHECKs de valores não negativos (`purchases`) e quantidade positiva (`purchase_items`). O enum `StockReferenceType` inclui `PURCHASE`, usado como referência das entradas de estoque de cada item de compra.

- **Delivery:** `Delivery` (`deliveries`, `orderId` único, enum `DeliveryStatus` com `PENDING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED`; colunas `notes`, `attemptCount`, `failedAt`, `failureReason` da migration `20260930130000_delivery_operations`, com CHECKs de tamanho e de tentativas) e, nas tabelas existentes, `orders.deliveryFeeCents` e `branches.deliveryEnabled/deliveryFeeCents/deliveryMinOrderCents` (migration `20260930120000_delivery`, com CHECKs de valores não negativos e backfill dos pedidos de entrega antigos). A fatia 3 acrescentou `deliveries.courierUserId` (FK `RESTRICT` para `users`, nula) e `assignedAt` com o índice `(tenantId, courierUserId)` (migration `20260930140000_delivery_courier`, sem backfill); o entregador é um `User` com o papel `DELIVERY`, sem tabela própria. O endereço de entrega continua nas colunas do próprio `Order` (snapshot).
- **CRM:** `Customer` (`customers`, por tenant: `name`, `phone` só dígitos, `email` minúsculo, `cpf` 11 dígitos, `notes`, `active`) e `orders.customerId` nullable (FK `ON DELETE SET NULL`, índice `(tenantId, customerId, createdAt)`). Migration `20261001100000_customers` (aditiva, sem backfill). Índices únicos parciais criados em SQL: `customers_tenantId_phone_active_key` (`(tenantId, phone) WHERE active`) e `customers_tenantId_cpf_key` (`(tenantId, cpf) WHERE cpf IS NOT NULL`), mais `CHECK`s de formato (telefone 8–15 dígitos, CPF 11 dígitos, e-mail minúsculo, nome, observações ≤ 500). O snapshot `customerName/customerPhone` do pedido não é reescrito pelo CRM.
- **Cupons:** `Coupon` (`coupons`, por tenant: `code` canônico, `discountType` PERCENTAGE/FIXED, `value`, `minOrderCents`, `maxDiscountCents`, `startsAt/endsAt`, `active`, `usageLimit/usageCount`, `perCustomerLimit`, `branchId` opcional), `CouponRedemption` (`coupon_redemptions`, `orderId` único) e `orders.discountCents` (padrão 0), `couponId` (FK `SET NULL`), `couponCode` (snapshot). Migration `20261002100000_coupons` (aditiva). Índice único parcial `coupons_tenantId_code_active_key` (`(tenantId, code) WHERE active`) criado em SQL, mais `CHECK`s: código canônico, percentual 1–100 / fixo ≥ 1, mínimo ≥ 0, teto só para percentual, `endsAt > startsAt`, limites ≥ 1, `usageCount <= usageLimit` e, em `orders`, `0 <= discountCents <= subtotalCents` e `totalCents = subtotalCents - discountCents + deliveryFeeCents`. Os 3 `CHECK`s de `orders` validam as linhas existentes ao serem criados (lock curto). Detalhes em `docs/CRM.md`.

- **Fidelidade:** `LoyaltyProgram` (`loyalty_programs`, uma linha por tenant), `LoyaltyReward` (`loyalty_rewards`), `LoyaltyAccount` (`loyalty_accounts`, `customerId` único, `balancePoints`) e `LoyaltyEntry` (`loyalty_entries`, o ledger de pontos: `type` EARN/REDEEM/ADJUSTMENT/REVERSAL, `points` com sinal, `balanceAfter`, origem e `idempotencyKey`). Migration `20261005001215_loyalty`. Em SQL: tabela append-only por trigger, CHECKs de saldo não negativo, sinal por tipo, origem por tipo e motivo obrigatório, índice único parcial de um `EARN` por pedido. Ver `docs/LOYALTY.md`.

- **Cashback:** `CashbackProgram` (`cashback_programs`), `CashbackAccount` (`cashback_accounts`, `customerId` único, `balanceCents`, `lastActivityAt`) e `CashbackEntry` (`cashback_entries`, o ledger em centavos: `type` EARN/USE/ADJUSTMENT/REVERSAL/EXPIRATION, `amountCents` com sinal, `balanceAfterCents`, origem e `idempotencyKey`); `orders.cashbackUsedCents`. Migration `20261005003323_cashback`. Em SQL: tabela append-only por trigger, CHECKs de saldo, sinal, origem e motivo, índices únicos parciais de um `EARN` e um `USE` por pedido, e o `CHECK orders_total_formula` recriado (`total = subtotal - discount - cashbackUsed + deliveryFee`) com `orders_cashback_range`. Ver `docs/CASHBACK.md`.

- **Fiado / contas a receber:** `CreditAccount` (`credit_accounts`, `customerId` único, `creditLimitCents`, `balanceCents` = dívida em aberto), `Receivable` (`receivables`: cliente, unidade, `orderId` único e opcional, `totalCents`, `paidCents`, `status` OPEN/PAID/CANCELLED), `ReceivableInstallment` (`receivable_installments`: `number`, `dueDate` do tipo `DATE`, `amountCents`, `paidCents`), `ReceivableEntry` (`receivable_entries`, o ledger: `type` CHARGE/PAYMENT/REVERSAL, `amountCents` com sinal, `balanceAfterCents`, forma de pagamento, `cashMovementId`, `reversedEntryId`, `idempotencyKey`) e `ReceivablePaymentAllocation` (`receivable_payment_allocations`: quanto de cada pagamento abateu cada parcela). `PaymentMethod` ganhou `ON_ACCOUNT`; `CashMovementType` ganhou `RECEIVABLE_PAYMENT` e `RECEIVABLE_REFUND`; `tenants.timezone` (`NOT NULL DEFAULT 'America/Sao_Paulo'`). Migration `20261005005645_receivables`. Em SQL: ledger e alocações append-only por trigger, CHECKs de limite e dívida não negativos, `paidCents` entre 0 e o valor, status coerente com o que foi pago, sinal por tipo, forma de pagamento obrigatória e real em pagamentos (`IS NOT NULL AND IN (...)`, porque `NULL IN (...)` passaria no CHECK), origem e motivo no estorno. Ver `docs/RECEIVABLES.md`.

Valores monetários são `Int` em centavos; quantidades de estoque são `Decimal(14,3)`; pontos são `Int`.

Os índices parciais (um caixa `OPEN` por unidade, uma comanda `OPEN` por mesa)
e o trigger que torna `cash_movements` imutável estão na migration
`20260930000000_partial_indexes_and_cash_immutability`. Os scripts em
`prisma/sql/` (`pnpm db:constraints`, `pnpm db:tabs-constraints`) continuam
válidos e idempotentes.

## O que NÃO existe

Rastreamento de entregas por mapa/GPS, FiscalDocument (NFC-e), gateway de
pagamento, cobrança SaaS, horários e endereço do restaurante (perfil), pedidos
de compra, contas a pagar, inscrições de push e tabelas de resumo para relatórios
(os relatórios agregam direto das tabelas de operação).

## Seed

`prisma/seed.ts` cria **apenas** os 8 `Role`s do enum, o catálogo de
`Permission`s e o vínculo `RolePermission` de cada papel. Nenhum tenant,
usuário ou dado de negócio fictício é criado pelo seed — cadastros reais
acontecem via `POST /auth/register`.
