# PROJECT_STATUS

## AUDITORIA TÉCNICA — 2026-09-30 (estado real, prevalece sobre as seções históricas abaixo)

As seções seguintes são um registro cronológico. Os trechos que dizem que nada
foi executado no ambiente ("Motivo, sem meias-palavras", "Pendência
estrutural") descrevem rodadas antigas e **estão superados** pela validação de
2026-09-28 e por esta auditoria.

### Estado por área

| Área | Estado | Evidência |
|---|---|---|
| Auth/RBAC | IMPLEMENTADO | `auth.e2e-spec`, guards globais, refresh com rotação |
| Multi-tenancy | IMPLEMENTADO | `tenant-isolation.e2e-spec`; `tenantId` sempre vem do JWT |
| Unidades (branch access) | IMPLEMENTADO | `BranchAccessService` usado em caixa, estoque, PDV, mesas, comandas e pedidos |
| Cardápio | IMPLEMENTADO | `menu`/`public-menu` e2e |
| Carrinho | IMPLEMENTADO | `cart-logic` (testes web) |
| Pedidos | IMPLEMENTADO | `public-orders`, `orders-admin` e2e |
| KDS | IMPLEMENTADO | `kds.e2e-spec`; atualização por polling, sem websocket |
| PDV | IMPLEMENTADO | `pos.e2e-spec` |
| Caixa | IMPLEMENTADO | `cash.e2e-spec`; depende de `pnpm db:constraints` manual |
| Mesas | IMPLEMENTADO | `tables.e2e-spec` |
| Comandas | IMPLEMENTADO | `tabs`/`tab-checkout` e2e; checkout idempotente |
| Estoque | IMPLEMENTADO | `inventory.e2e-spec` |
| Compras e fornecedores | IMPLEMENTADO | `purchases.e2e-spec` (29 casos); ver seção "Compras de estoque" |
| Perfil do restaurante | PARCIAL | página lê nome, slug, razão social e documento do tenant; endereço, horários e canais são demonstrativos; edição não persiste |
| Demo | DEMO/MOCK | `/demo/*` sem chamadas à API |
| Pagamentos | PARCIAL | `PaymentMethod` CASH/PIX/CARD é só rótulo; `provider` só `INTERNAL`; sem gateway |
| Delivery | PARCIAL | primeira fatia da Fase 10 implementada: taxa e pedido mínimo por unidade, registro da entrega, despachar/confirmar, tela `/dashboard/delivery` (ver `docs/DELIVERY.md`). Sem entregador, falha de entrega, mapas/GPS e sem entrega pelo PDV |
| CRM | NÃO IMPLEMENTADO | sem modelo de cliente |
| Relatórios | NÃO IMPLEMENTADO | só métricas do dia derivadas de `GET /orders` |
| WhatsApp/IA | NÃO IMPLEMENTADO | |
| NFC-e | NÃO IMPLEMENTADO | |
| SaaS Billing | NÃO IMPLEMENTADO | sem cobrança; `Tenant.status` já bloqueia login e cardápio público quando SUSPENDED/CANCELLED |

### Validações executadas nesta auditoria (sem alterar código)

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | PASSOU (api + web) |
| `pnpm lint` | PASSOU |
| `pnpm test` | PASSOU (api 60/60, web 40/40) |
| `pnpm build` | PASSOU (api + web) |
| `pnpm --filter api test:e2e` | PASSOU (13 suítes, 144/144) na auditoria; 14 suítes, 161/161 após as correções, em banco descartável recriado com `migrate deploy` + seed |
| `prisma migrate status` / `migrate diff` | banco de desenvolvimento em sincronia; diff schema × banco vazio |

### Problemas da auditoria e correções (2026-09-30)

| Problema | Situação |
|---|---|
| Pedidos sem checagem de unidade (`GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`) | CORRIGIDO: quem não é OWNER/ADMIN só lista, lê e altera pedidos das unidades a que está vinculado; filtro por unidade sem acesso retorna 403 e pedido de outra unidade retorna 404 |
| `POST /pos/orders` e `POST /public/orders` sem idempotência | CORRIGIDO: campo opcional `idempotencyKey`; a mesma chave devolve o mesmo pedido (inclusive em envios simultâneos) e uma chave reutilizada com outro conteúdo retorna 409. PDV e checkout do site geram a chave por tentativa. Sem chave, o comportamento antigo continua |
| `Tenant.status` ignorado | CORRIGIDO: SUSPENDED e CANCELLED não fazem login nem refresh, e o cardápio e o checkout públicos respondem 404. Um access token já emitido continua válido até expirar (15 min) |
| Índices parciais e trigger do caixa fora das migrations | CORRIGIDO: migration `20260930000000_partial_indexes_and_cash_immutability` (idempotente). Em bancos que já rodaram `db:constraints`, basta `prisma migrate deploy` para registrá-la |
| Login sem limite próprio | CORRIGIDO: login e cadastro limitados a `AUTH_RATE_LIMIT_PER_MINUTE` (padrão 10) por IP e refresh a 30 por minuto. O contador continua em memória (por instância da API), não no Redis |
| Refresh token sem detecção de reuso e não atômico | CORRIGIDO: o token é reivindicado de forma atômica; reuso depois de 10 s revoga todas as sessões do usuário e gera auditoria. O frontend agora evita duas chamadas simultâneas de refresh |
| CORS refletia qualquer origem com `CORS_ORIGIN` vazio | CORRIGIDO: sem origem configurada o CORS fica desligado; `CORS_ORIGIN` aceita várias origens separadas por vírgula |
| Endpoint autenticado sem `@RequirePermissions` fica liberado | NÃO ALTERADO: hoje só `/auth/me` e `/branches/accessible`, intencionais |
| `CreateProductDto.price` em reais | NÃO ALTERADO: mudar exigiria alterar o contrato da API e o frontend |
| `MANIFEST.sha256`, `tsbuildinfo` rastreado, logo duplicado | NÃO ALTERADO: não é problema de segurança |
| Perfil do restaurante usa dados demonstrativos como base | NÃO ALTERADO: comportamento intencional, marcado na tela |

Testes dos itens corrigidos: `apps/api/test/security-hardening.e2e-spec.ts` (15 casos). Dois testes existentes (`kds` e `orders-admin`) passaram a vincular o funcionário à unidade, porque agora isso é exigido.

### Local x GitHub (origin/master)

- Local está 1 commit à frente (`0ba4bac teste 2`: perfil do restaurante e documentação) e 1 atrás (`585d01d`, que apaga `.claude/settings.json` pelo GitHub).
- Localmente, `.claude/settings.json` também aparece removido (mudança não commitada), igual ao remoto.
- Nenhum código de estoque, mesas, comandas ou caixa diverge: tudo isso já está em `66f3c34`.


## STATUS: MVP VALIDADO COM PENDÊNCIAS (validação real de 2026-09-28)

> **Atualização mais recente:** em 2026-09-28, pela primeira vez neste
> projeto, `pnpm install`, `docker compose up`, `prisma migrate`,
> `prisma db execute` (constraints), o seed, `typecheck`, `lint`, os testes
> unitários (api+web), a suíte e2e completa (12 arquivos/118 casos, contra
> Postgres 16 + Redis 7 reais em Docker) e o build de produção de ambos os
> apps **rodaram de verdade**, num ambiente com rede/Docker disponíveis. Ver
> a seção "Validação Real — 2026-09-28" no final deste arquivo para o
> relatório completo (o que passou, os 2 problemas reais encontrados e
> corrigidos, e as pendências que restam). As seções abaixo (histórico de
> fase/fatia) permanecem como registro do que foi revisado manualmente antes
> disso e não foram reescritas.
>
> **Reconciliação (rodada seguinte à 08.1):** foi reportado que o ZIP não
> continha o Caixa. Auditoria física do repositório e do ZIP entregue
> (`restaurant-saas-fase08-1-validacao.zip`) mostrou que **ambos contêm o
> Caixa completo e são idênticos** (`diff -rq` sem diferenças). O estado
> descrito (sem `CashRegisterSession`/`CashMovement`, sem `Order.branchId`,
> status "Fatia 07", só `CASH_REGISTER_PLAN.md`) corresponde ao ZIP **anterior**
> `restaurant-saas-hardening-pos-fatia07.zip`, gerado quando só existia o
> plano. Nada foi reimplementado. Para evitar nova ambiguidade, o ZIP desta
> rodada inclui `MANIFEST.sha256` (hash de cada arquivo) — ver seção
> "Reconciliação do estado do Caixa" no fim deste arquivo.

**Motivo, sem meias-palavras:** este ambiente de execução não tem acesso à
rede (`registry.npmjs.org`, `github.com` e até `archive.ubuntu.com` retornam
HTTP 403) nem `pnpm`/Docker/PostgreSQL/Redis instalados. Isso significa que
`pnpm install`, `prisma migrate`, `pnpm test` (e2e) e `pnpm build` — as
validações que decidiriam "MVP VALIDADO" — **nunca puderam rodar aqui, em
nenhuma rodada deste projeto**, fase 08.1 incluída. Não marco "validado" nem
"validado com pendências" porque isso exigiria ter executado o fundamental,
e não executei — ver a tabela real na seção "Fase 08.1" abaixo para o que
efetivamente foi verificado (checagem estática de todo o repositório,
compilação TypeScript estrita de todos os módulos de lógica pura, execução
real dessa lógica, e conferência manual de cada nome de modelo/campo/índice
usado no código novo contra o `schema.prisma`).

**O que isso NÃO significa:** não há evidência de nenhum bug real
conhecido. As sete fatias e a rodada de caixa foram revisadas linha a linha
a cada etapa; esta rodada (08.1) encontrou e corrigiu 3 imports não usados
e não encontrou mais nada. O código está pronto para ser instalado e
validado de verdade — só isso ainda não aconteceu neste ambiente.

> Este arquivo reflete o estado REAL do projeto. Não é atualizado com
> otimismo — apenas com o que foi de fato implementado, revisado e (quando
> o ambiente permitiu) executado.

## Compras de estoque (2026-09-30)

Módulo de compras e fornecedores integrado ao estoque profissional. Detalhes em `docs/PURCHASES.md`.

- **Modelo:** `Supplier`, `Purchase`, `PurchaseItem`, `PurchaseSequence` e o enum `PurchaseStatus` (DRAFT, RECEIVED, CANCELLED). Migration `20260930100000_purchases` (aplica em banco vazio; inclui CHECKs de valores não negativos). O enum `StockReferenceType` ganhou o valor `PURCHASE`.
- **Recebimento:** transação única que trava a compra (`FOR UPDATE`), confere o status e gera uma `ENTRY` por item pelo `StockLedgerService` existente, com custo médio, lote, validade, fornecedor e número da compra. Idempotente: o segundo `receive` devolve a compra com `idempotentReplay: true`, e a unique `(referenceType, referenceId, inventoryItemId, type)` do ledger é a trava no banco.
- **Cancelamento:** DRAFT cancela sem tocar no estoque. RECEIVED exige motivo e estorna cada entrada com `REVERSAL` pelo ledger; se o saldo não cobre (e a unidade não permite estoque negativo) o estorno é recusado com 409 e nada muda. O custo médio **não** é recalculado no estorno, como em qualquer saída.
- **Custo:** o estoque usa o custo unitário de cada item. Frete, desconto e outros custos ficam só no total da compra, sem rateio.
- **API:** `GET/POST /v1/purchases`, `GET/PATCH /v1/purchases/:id`, `POST /v1/purchases/:id/receive`, `POST /v1/purchases/:id/cancel`, `GET/POST /v1/suppliers`, `GET/PATCH /v1/suppliers/:id`.
- **Permissões:** `purchases.read/create/update/receive/cancel` e `suppliers.read/create/update`, para OWNER, ADMIN e MANAGER. CASHIER, KITCHEN, WAITER, DELIVERY e VIEWER não têm acesso. As permissões novas são criadas pelo seed: rode `pnpm db:seed` em bancos existentes e os usuários precisam entrar de novo.
- **Frontend:** `/dashboard/estoque/compras` (indicadores, filtros, tabela e ações), `/nova`, `/[id]` e `/[id]/editar`, mais o diálogo de fornecedores.
- **Testes:** unitários dos cálculos (`purchase-calculations.spec.ts`, `purchases-logic.test.ts`) e `purchases.e2e-spec.ts` (recebimento, idempotência, concorrência, estorno, isolamento por tenant e unidade, permissões, validações e auditoria).
- **Limitações:** sem pedido de compra, sem contas a pagar, sem rateio de frete, sem conversão de unidade na compra (a quantidade é sempre na unidade de estoque do insumo) e sem importação de nota fiscal.

## Delivery (2026-09-30)

Primeira fatia da Fase 10. Detalhes em `docs/DELIVERY.md`.

- **Modelo:** `Delivery` (1:1 com o pedido, enum `DeliveryStatus`: PENDING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED), `Order.deliveryFeeCents` (snapshot da taxa) e, em `Branch`, `deliveryEnabled`, `deliveryFeeCents` e `deliveryMinOrderCents`. Migration `20260930120000_delivery`, com backfill dos pedidos de entrega já existentes.
- **Regra central:** o endereço continua como snapshot no pedido. A taxa e o pedido mínimo são calculados só no servidor, em centavos, na criação do pedido. O status do pedido (comercial) e o da entrega (operacional) andam juntos, e para pedidos de entrega só o `DeliveryService` leva `READY → OUT_FOR_DELIVERY → DELIVERED`, na mesma transação.
- **API:** `GET /v1/delivery`, `POST /v1/delivery/:id/dispatch`, `POST /v1/delivery/:id/complete`, `GET/PUT /v1/delivery/settings`. Despachar/concluir são idempotentes (segunda chamada devolve `idempotentReplay: true`).
- **Permissões:** `delivery.read`, `delivery.update` e `delivery.configure` (OWNER, ADMIN, MANAGER; o papel DELIVERY recebe `read` e `update`). Entram pelo seed: rode `pnpm db:seed` em bancos existentes.
- **Auditoria transacional:** `DELIVERY_DISPATCHED`, `DELIVERY_COMPLETED`, `DELIVERY_CANCELLED`, `DELIVERY_SETTINGS_UPDATED`.
- **Mudança de comportamento:** o endpoint genérico de status recusa `COMPLETED` para pedido de entrega (`409 DELIVERY_FLOW_REQUIRED`); o KDS e o detalhe do pedido deixam de oferecer "Finalizar" nesses pedidos.
- **Limitações:** sem entregador, sem falha/reentrega, sem mapas/GPS, taxa única por unidade, PDV sem entrega.

## Estado geral (atualizado na Fatia 08)

O projeto pivotou do roadmap original de 20 fases para fatias verticais de
MVP (ver `/areas/restaurant-saas-platform.md` do contexto do usuário, se
aplicável, ou simplesmente o histórico abaixo). **Implementado e revisado
até agora:** Fase 01 (fundação/auth/RBAC/multi-tenancy) → Fatia 01
(cardápio administrativo) → Fatia 02 (cardápio público) → Fatia 03
(carrinho) → Fatia 04 (checkout + pedido, com correção de privacidade
aplicada) → Fatia 05 (painel administrativo de pedidos) → Fatia 06 (KDS) →
Fatia 07 (PDV de balcão) → rodada de hardening → **Fatia 08 (Caixa, seção
mais recente abaixo)**. Nenhuma fatia foi
refeita ou revertida — cada seção abaixo é o registro histórico de quando
cada uma foi concluída.

**Pendência estrutural que se arrasta desde a Fase 01 e afeta TODAS as
fatias**: nenhuma instalação de dependências, build, teste ou migration foi
*executada de fato* em nenhum momento — o ambiente de desenvolvimento usado
não tem acesso à rede nem PostgreSQL/Docker. Todo o código de todas as
fatias foi revisado manualmente (linha a linha, sem compilador disponível).
Rodar `pnpm install && pnpm db:migrate && pnpm typecheck && pnpm lint &&
pnpm test` num ambiente real (com rede e Postgres) é o passo obrigatório
antes de considerar qualquer fatia definitivamente fechada em produção.

## Fase 01 — Fundação, Autenticação, Multi-tenancy, RBAC

**Status: CONCLUÍDA COM PENDÊNCIAS**

A pendência não é de código funcional conhecido: é que nenhuma instalação de
dependências, build, teste ou migration foi *executada de fato* neste
ambiente de desenvolvimento (ver seção "Validações" abaixo). Todo o código
foi produzido e revisado manualmente (linha a linha, sem compilador
disponível), e 10 problemas reais foram encontrados e corrigidos durante essa
revisão — ver "Histórico de correções".

## Por que "CONCLUÍDA COM PENDÊNCIAS" e não "CONCLUÍDA"

O ambiente onde este código foi escrito não tem acesso à internet (registro
npm bloqueado) nem Docker/PostgreSQL instalados. Isso significa que:

- `pnpm install` nunca rodou → nenhuma dependência foi de fato resolvida/baixada.
- `prisma generate` / `prisma migrate dev` nunca rodaram → não existe
  `@prisma/client` gerado nem pasta `prisma/migrations/`.
- `tsc`, `eslint`, `jest`, `next build`, `nest build`, `docker compose up`
  nunca rodaram.

Nada disso foi inventado ou marcado como "passou" sem ter sido de fato
executado. Ver `docs/PROJECT_STATUS.md#validações` para o status real de cada
item, e o README para os comandos que **precisam ser rodados no ambiente do
desenvolvedor** (com rede e Docker) antes de considerar a Fase 01
definitivamente fechada.

## O que existe (revisado manualmente, não compilado)

### Monorepo
- pnpm workspaces (`pnpm-workspace.yaml`) + Turborepo (`turbo.json`)
- `apps/api` (NestJS), `apps/web` (Next.js)
- `packages/types`, `packages/ui`, `packages/config`, `packages/eslint-config`,
  `packages/tsconfig`
- Husky + lint-staged configurados (`.husky/pre-commit`)

### Backend (`apps/api`)
- Módulos: `auth`, `users`, `tenants`, `branches`, `audit`, `health`, `prisma`, `common`
- Auth completo: `register`, `login`, `refresh` (rotação single-use),
  `logout` (revogação), `me`
- Senha com Argon2; access token JWT curto + refresh token JWT em cookie
  `httpOnly`, hash SHA-256 do refresh guardado no banco
- RBAC: `Role`/`Permission`/`RolePermission`/`UserRole` + guards
  `@Roles()`/`@RequirePermissions()`, globais via `APP_GUARD`
- Isolamento de tenant: todo service recebe `tenantId` explícito, extraído
  exclusivamente do JWT (`@CurrentUser()`), nunca de body/query/params
- `AuditLog` conectado a `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGOUT`,
  `TENANT_REGISTERED`
- `RequestIdMiddleware`, logging estruturado (`nestjs-pino`, com redação de
  senha/token/cookie), `GlobalExceptionFilter` no formato padronizado
- Health checks (`/health`, `/health/live`, `/health/ready`) — version-neutral,
  checam Postgres (via indicador Prisma customizado) e Redis
- Swagger em `/docs` fora de produção
- `helmet`, CORS restrito, `ThrottlerGuard` (100 req/60s), `ValidationPipe`
  com `whitelist`+`forbidNonWhitelisted` (mitiga mass assignment)

### Banco de dados
- `schema.prisma` completo: `Tenant`, `Branch`, `User`, `Role`, `Permission`,
  `RolePermission`, `UserRole`, `UserBranch`, `RefreshToken`, `AuditLog`
- Enums `TenantStatus`, `BranchStatus`, `UserStatus`, `RoleName`
- Constraints/índices revisados manualmente (ver `docs/database.md`)
- `prisma/seed.ts` popula roles + permissions + vínculo role↔permission —
  nenhum dado fictício de negócio
- **Nenhuma migration foi gerada ainda** — ver pendências

### Frontend (`apps/web`)
- Páginas `/`, `/login`, `/register`, `/dashboard` (protegida)
- `AuthProvider` (React context): access token em memória (nunca
  `localStorage`), refresh silencioso ao montar, `login`/`register`/`logout`
- `middleware.ts`: guarda de borda (presença do cookie `refresh_token`) +
  verificação real client-side em `/dashboard`
- Tailwind + componentes mínimos (`Button`, `Input`)

### Testes
- Unitários (sem banco): `roles.guard.spec.ts`, `permissions.guard.spec.ts`,
  `token.util.spec.ts`
- E2E (precisam de Postgres real): `auth.e2e-spec.ts` (register/login/
  duplicidade/refresh/logout/me), `tenant-isolation.e2e-spec.ts`
  (teste **obrigatório** de isolamento entre tenants — usuário, lista de
  usuários, branch, `/tenants/current`)
- Todos os dados únicos de teste (`slug`, `email`, `document`) são gerados
  por helpers com contador monotônico (`uniqueSuffix()`, `uniqueDocument()`
  em `test/test-app.util.ts`) — nenhum valor fixo reaproveitado entre
  chamadas

## Histórico de correções desta fase (revisão manual, sem compilador)

1. Diretórios de `apps/*` e `packages/*` corrompidos por expansão de chaves
   não suportada pelo shell (`mkdir -p a/{b,c}`) — refeito com caminhos
   explícitos.
2. `packages/eslint-config`, `packages/types`, `packages/ui` e
   `packages/config/package.json` nunca haviam sido escritos (falha
   silenciosa de diretório inexistente) — recriados.
3. `PrismaHealthIndicator` importado de `@nestjs/terminus`, que **não**
   exporta esse indicador — substituído por indicador customizado
   (`prisma.health.ts`) usando `SELECT 1`.
4. Rotas de health check estavam sendo prefixadas com `/v1` pelo
   versionamento global — corrigido com `@Controller({ version:
   VERSION_NEUTRAL })`.
5. `let server: unknown` nos testes e2e é incompatível com a tipagem do
   `supertest` — corrigido.
6. `pino-pretty` usado no transport de log de desenvolvimento mas ausente do
   `package.json` — adicionado.
7. **Bug de dados de teste**: `registerPayload()` em `auth.e2e-spec.ts`
   reutilizava um `document` fixo entre chamadas, e `registerTenant()` em
   `tenant-isolation.e2e-spec.ts` gerava o document a partir de
   `Date.now()` sem contador (colisão possível em chamadas na mesma
   milissegundo) — ambos corrigidos com o helper único `uniqueDocument()`.
8. Dependência `uuid`/`@types/uuid` declarada mas nunca usada (o código usa
   `crypto.randomUUID()` nativo) — removida.
9. Dependência `tailwind-merge` declarada mas nunca usada no frontend —
   removida.
10. `apps/web` declarava `@restaurant-saas/eslint-config` mas usava apenas
    `next/core-web-vitals` — dependência não utilizada removida.
11. **Bug crítico de integração navegador/API, reportado pelo usuário após
    revisão do ZIP**: o cookie `refresh_token` era emitido com
    `Path=/auth`. Como o versionamento global de rotas (`main.ts`) faz o
    endpoint real ser `/v1/auth/refresh`, essa string não é prefixo de
    `/auth`, então um navegador real **nunca enviaria** o cookie de volta
    no refresh — e o `middleware.ts` do frontend, que lê esse mesmo cookie
    em requisições para `/dashboard` (origem/porta diferente), também
    nunca o veria, redirecionando usuários autenticados para `/login`.
    Nenhum teste e2e detectou isso porque usam `.set('Cookie', cookie)`
    manualmente, contornando por completo o path-matching real do
    navegador. Corrigido trocando `Path` para `/` (único valor que é
    prefixo tanto de `/v1/auth/refresh` quanto de `/dashboard`), com a
    ressalva documentada em `docs/authentication.md` de que essa
    estratégia depende de frontend e API compartilharem o mesmo host (só
    vale para dev local ou produção atrás de um proxy reverso sob o mesmo
    domínio-raiz). Foram adicionados testes que inspecionam os atributos
    reais do header `Set-Cookie` (`Path=/`, `HttpOnly`, `SameSite=Lax`) em
    vez de só confirmar que o valor do cookie existe — para que essa classe
    de regressão volte a ser pega por teste automatizado.

## Pendências conhecidas

- **Migrations do Prisma não foram geradas.** Rodar `pnpm db:generate` e
  `pnpm db:migrate` num ambiente com PostgreSQL acessível é o primeiro passo
  obrigatório antes de qualquer outra validação. Optei por **não** escrever
  manualmente o SQL de migration "simulando" a saída do Prisma: sem uma
  instância real do Postgres para validar contra ela, um SQL escrito à mão
  poderia conter um erro sutil (nome de constraint, tipo de coluna) e isso
  seria pior do que simplesmente deixar o passo explícito para quem tem o
  ambiente completo.
- Nenhuma instalação/compilação/teste foi executada de fato (ver
  "Validações"). O código foi revisado manualmente, não substitui a
  necessidade de rodar `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
  antes de aceitar a fase como definitivamente fechada.
- Não existe teste de integração (e2e) demonstrando o `PermissionsGuard`
  **bloqueando** um papel sem permissão — só existe cobertura unitária da
  lógica do guard isoladamente. Isso é inerente ao escopo da Fase 01: o
  único fluxo de criação de usuário é `register` (sempre cria um `OWNER`,
  que tem todas as permissões pelo seed); não há ainda convite de usuário
  com papel restrito para gerar um cenário real de bloqueio ponta a ponta.
- `docker-compose.yml` sobe apenas Postgres+Redis; a containerização das
  próprias apps (`api`/`web`) fica para uma fase de deploy futura
  (decisão consciente, ver `docs/architecture.md`).
- **Limitação de produção herdada da correção do cookie (item 11 do
  histórico acima)**: `Path=/` resolve dev local porque `localhost:3000` e
  `localhost:4000` são o mesmo host (cookie `Domain` ignora porta). Em
  produção, se frontend e API ficarem em hosts distintos de verdade (ex.
  `app.exemplo.com` e `api.exemplo.com`), esse cookie **não** vai
  atravessar — `Path` não resolve isso, só `Domain` compartilhado (mesmo
  domínio-raiz + proxy reverso) ou uma troca de estratégia (BFF no
  Next.js). Ver `docs/authentication.md` → "Escopo do cookie de refresh".
  Precisa ser decidido antes do primeiro deploy real, não necessariamente
  nesta fase.

## Validações

| Verificação        | Resultado | Motivo |
|---------------------|-----------|--------|
| TypeScript (`tsc`)  | NÃO EXECUTADO | `typescript` e `@types/*` não instalados; sem rede para `pnpm install` neste ambiente |
| ESLint              | NÃO EXECUTADO | mesmo motivo |
| Testes (unit + e2e) | NÃO EXECUTADO | dependências (`jest`, `ts-jest`, etc.) não instaladas; testes e2e também exigem PostgreSQL/Redis reais, indisponíveis aqui |
| Build frontend      | NÃO EXECUTADO | `next` não instalado |
| Build backend       | NÃO EXECUTADO | `@nestjs/cli` não instalado |
| Prisma validate/generate | NÃO EXECUTADO | `prisma` não instalado (depende de `pnpm install`) |
| Migrations          | NÃO EXECUTADO | requer PostgreSQL real, indisponível neste ambiente |
| Seed                | NÃO EXECUTADO | depende de client Prisma gerado + banco migrado |
| Docker              | NÃO EXECUTADO | `docker` não disponível neste ambiente |

Em vez dessas execuções, foi feita **revisão manual completa**: toda
importação relativa foi resolvida programaticamente contra o sistema de
arquivos, toda dependência usada no código foi cruzada contra o
`package.json` correspondente (e vice-versa, para achar dependências
declaradas e não usadas), todo JSON foi parseado, e o `schema.prisma` foi
lido em busca de relações ambíguas, enums inválidos e defaults incoerentes.
Os 10 problemas reais encontrados por essa revisão estão listados acima —
todos corrigidos.

## Próxima fase

**Fase 02 — Configurações do restaurante** continua sendo a próxima fase do
roadmap original de 20 fases. Na prática, o desenvolvimento pivotou para uma
abordagem de **fatias verticais de MVP** (ver `docs/MVP_PLAN.md` quando
existir) — a Fase 01 (fundação) permanece como pré-requisito de tudo abaixo.

---

# MVP — Fatia 01: Cardápio Administrativo

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo da Fase 01: código
completo e revisado manualmente, mas nenhuma instalação/build/teste/migration
foi executada de fato neste ambiente — ver "Validações" abaixo).

## O que foi implementado

- **Modelos Prisma**: `Category` (`tenantId`, `name`, `description?`,
  `active`, `displayOrder`) e `Product` (`tenantId`, `categoryId`, `name`,
  `description?`, `priceCents` — inteiro, nunca float —, `imageUrl?`,
  `active`, `displayOrder`), com back-relations em `Tenant`. `Product.category`
  usa `onDelete: Restrict`. Detalhes e decisões em `docs/database.md`.
- **Permissões novas** no seed: `categories.read/create/update/delete`,
  espelhando o padrão de `products.*` já existente e distribuídas entre os
  mesmos papéis (OWNER/ADMIN full, MANAGER read+create+update, WAITER/VIEWER
  read).
- **Backend** — módulos `categories` e `products` (DTOs, service,
  controller, module), registrados em `AppModule`:
  - `GET/POST /v1/categories`, `GET/PATCH/DELETE /v1/categories/:id`
  - `GET/POST /v1/products`, `GET/PATCH/DELETE /v1/products/:id`
  - Preço trafega em **reais** no contrato da API (`price: 24.9`), convertido
    para/de `priceCents` só na borda do `ProductsService`.
  - Toda escrita de produto revalida que `categoryId` pertence ao mesmo
    tenant do usuário autenticado (via `CategoriesService.findOneForTenant`)
    — 404 se for de outro tenant, tanto no `create` quanto no `update`.
  - Excluir uma categoria com produtos vinculados retorna `409
    CATEGORY_HAS_PRODUCTS` em vez de estourar a constraint do banco.
- **Frontend** — `/dashboard/cardapio` com abas Categorias/Produtos
  (`CategoriesPanel.tsx`, `ProductsPanel.tsx`, `lib/cardapio-api.ts`),
  reaproveitando os componentes `Button`/`Input` já existentes e um novo
  `Textarea` no mesmo padrão. CRUD completo, ativar/desativar, loading/empty
  states, feedback de erro inline. Link adicionado em `/dashboard` e texto
  desatualizado da home/dashboard corrigido.
- **Testes** (`apps/api/test/menu.e2e-spec.ts`, 9 casos): CRUD de categoria,
  CRUD de produto com conversão de preço, exclusão bloqueada com produtos
  vinculados (409), isolamento de tenant em categoria (404 em GET/PATCH/DELETE
  cross-tenant), **produto não pode ser criado nem movido para categoria de
  outro tenant** (404), leitura de produto cross-tenant (404), acesso não
  autenticado (401), payload inválido — preço negativo/nome vazio (400).

## Regras de negócio implementadas

1. `tenantId` sempre do JWT, nunca do body — mesmo padrão da Fase 01.
2. `categoryId` de um produto é sempre revalidado contra o tenant do usuário.
3. Preço nunca é float na camada de persistência (inteiro em centavos).
4. Categoria com produtos não pode ser excluída.

## Pendências

- Nenhuma pendência de regra de negócio conhecida dentro do escopo desta
  fatia (upload de imagem foi explicitamente adiado — usa `imageUrl`).
- Mesma pendência estrutural da Fase 01: migration do Prisma para
  `Category`/`Product` ainda não foi gerada (requer Postgres real);
  `pnpm db:migrate` precisa rodar antes de qualquer teste de verdade.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| Prisma validate/generate | NÃO EXECUTADO | ambiente sem `pnpm install`/rede |
| Migrations | NÃO EXECUTADO | requer PostgreSQL real |
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas |
| Testes (`menu.e2e-spec.ts`) | NÃO EXECUTADO | idem + requer Postgres real |
| Build frontend/backend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports relativos e alias `@/` resolvidos
programaticamente contra o sistema de arquivos, todo JSON parseado, chaves de
`schema.prisma`/`seed.ts`/testes novos balanceadas, nenhuma dependência nova
necessária (todos os imports novos já existiam no `package.json`).

---

# MVP — Fatia 02: Cardápio Público

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo de sempre: código
completo e revisado manualmente, nenhuma instalação/build/teste/migration
executada de fato neste ambiente — ver "Validações" abaixo).

## O que foi implementado

- **Backend** — módulo `public-menu` (`PublicMenuController`,
  `PublicMenuService`, DTOs de resposta explícitos), registrado em
  `AppModule`. Endpoint público (`@Public()`, sem JWT):
  `GET /v1/public/menu/:slug`.
  - Busca o `Tenant` **somente pelo `slug`** — nunca por `tenantId` (não há
    JWT nessa rota).
  - Uma única query Prisma aninhada (`select`/`include` com `where` nas
    relações) — sem N+1: categorias `active: true` e produtos `active: true`
    já filtrados pelo próprio Postgres, ordenados por `displayOrder` asc,
    `name` asc nos dois níveis.
  - Categorias que ficam sem nenhum produto ativo (produto inativo ou a
    própria categoria sem produtos) são removidas da resposta — nunca uma
    seção vazia.
  - Response DTO explícito (`PublicMenuResponseDto`): `restaurant{name,slug}`,
    `categories[]{id,name,description,products[]{id,name,description,price,imageUrl}}`.
    Nenhum campo administrativo (`tenantId`, `active`, `displayOrder`, dados
    fiscais etc.) sai desse endpoint — testado explicitamente.
  - Slug inexistente → `404`.
  - Conversão `priceCents → price` reaproveita `common/util/money.util.ts`
    (o mesmo util extraído do `ProductsService` — nenhuma regra de dinheiro
    duplicada).
- **Frontend** — `/menu/[slug]` como **Server Component** (fetch acontece no
  servidor, sem flash de loading client-side): `page.tsx`, `loading.tsx`
  (estado de carregamento via convenção nativa do Next.js) e `not-found.tsx`
  (restaurante inexistente, via `notFound()`). Erros de API diferentes de 404
  caem num estado de erro genérico inline. `lib/public-menu-api.ts` reaproveita
  o `apiFetch` já existente (nenhuma segunda abordagem de fetching).
  `components/menu/ProductCard.tsx`: preço formatado em reais, imagem via
  `imageUrl` com fallback (emoji + fundo neutro) quando ausente, botão
  "Em breve" desabilitado (preparado para o Carrinho, não implementado).
  Layout mobile-first: nav de categorias com scroll horizontal, grid
  responsivo (1 coluna no celular, 2–3 em telas maiores), `truncate`/
  `line-clamp-2` evitando overflow de texto.
- **Testes** (`apps/api/test/public-menu.e2e-spec.ts`, 7 casos): 404 para
  slug inexistente (sem header de autenticação, confirmando rota pública),
  formato da resposta pública + ausência de campos administrativos,
  categoria inativa oculta mesmo com produtos ativos, produto inativo oculto
  mantendo a categoria se houver outro produto ativo, categoria sem nenhum
  produto ativo fica oculta, ordenação por `displayOrder`/`name` em
  categorias e produtos, `imageUrl` nulo vs. preenchido.

## Regras implementadas

1. Identificação pública exclusivamente por `tenant.slug` — nunca por
   `tenantId` vindo do cliente.
2. Só categoria `active=true` e só produto `active=true` **dentro** de uma
   categoria ativa aparecem.
3. Categoria sem produto ativo não aparece (sem seções vazias).
4. Consulta única, sem N+1 (nested `select`/`where` do Prisma).
5. Query e DTO de resposta específicos para o público — não é o endpoint
   administrativo com uma flag `public=true`.

## Pendências

- Mesma pendência estrutural das fatias anteriores: migration do Prisma
  ainda não foi gerada (nada de novo nesta fatia — `Category`/`Product` já
  estavam pendentes desde a Fatia 01; nenhum modelo novo foi criado agora).
- Upload de imagem, carrinho, checkout e pedidos deliberadamente fora de
  escopo, como pedido.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| Prisma validate/generate | NÃO EXECUTADO | ambiente sem `pnpm install`/rede |
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas |
| Testes (`public-menu.e2e-spec.ts`) | NÃO EXECUTADO | idem + requer Postgres real |
| Build frontend/backend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports relativos e alias `@/` (incluindo os novos
`app/menu/[slug]/*` e `components/menu/*`) resolvidos programaticamente
contra o sistema de arquivos, JSON revalidado, chaves/parênteses dos novos
arquivos balanceados, nenhuma dependência nova necessária.

## Próxima fatia

**Carrinho** (client-side, sobre o cardápio público já existente), seguido
de **Checkout** e **Criação do pedido**.

---

# MVP — Fatia 03: Carrinho Client-Side

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo de sempre: código
completo e revisado manualmente; nenhuma instalação/build/teste executada de
fato neste ambiente — ver "Validações" abaixo).

## Arquitetura do carrinho

Camadas deliberadamente separadas:

- **`lib/cart-types.ts`** — `CartItem` (`productId`, `name`, `priceCents`,
  `imageUrl`, `quantity`) e `CartState` (`restaurantSlug`, `restaurantName`,
  `items[]`). Sem `any` em nenhum arquivo novo.
- **`lib/cart-logic.ts`** — lógica pura, sem React e sem DOM: `addItem`,
  `incrementItem`, `decrementItem`, `removeItem`, `clearCart`,
  `getTotalQuantity`, `getSubtotalCents`, `needsRestaurantSwitchConfirm`,
  `loadCart`/`saveCart`. Toda regra de negócio do carrinho mora aqui —
  testável sem montar nenhum componente.
- **`lib/cart-context.tsx`** — camada fina de React (`CartProvider`/
  `useCart`) por cima da lógica pura. Só aqui existe `useState`/`useEffect`,
  acesso a `localStorage` e o único `window.confirm()` (efeito colateral que
  uma função pura nunca poderia ter).
- **`lib/money.ts`** — `toCents`/`formatCentsAsBRL`. Espelha deliberadamente
  o contrato de `apps/api/src/common/util/money.util.ts` (arredondar uma
  vez, centavos como fonte da verdade, reais só na apresentação) — **não
  importado** do backend porque `apps/api` e `apps/web` são deployáveis
  separados sem pacote de runtime compartilhado para isso ainda
  (`packages/types` só tem tipos, e a API não depende dele). Trade-off
  documentado aqui deliberadamente, não um esquecimento.

## Persistência e SSR

- Chave `localStorage`: `restaurant-saas:cart`.
- `CartProvider` inicia com `emptyCart` tanto no servidor quanto na primeira
  renderização client — **sem hydration mismatch**, porque a leitura do
  `localStorage` só acontece dentro de um `useEffect` (pós-montagem,
  client-only). O carrinho real "aparece" um instante depois; é o padrão
  seguro para estado apoiado em storage do navegador no App Router.
- Um segundo `useEffect` (guardado por `hasHydrated`) persiste toda mudança
  de estado de volta ao `localStorage`, sem nunca sobrescrever um carrinho
  real com o estado vazio inicial antes da leitura terminar.
- `loadCart()`/`saveCart()` em `cart-logic.ts` fazem `typeof window ===
  'undefined'` como primeira linha — nunca tocam `localStorage` durante SSR.

## Isolamento por restaurante

`CartState.restaurantSlug` é a fonte da verdade de "de quem é este
carrinho". Regras implementadas em `cart-logic.ts` (puras, testadas):

- `needsRestaurantSwitchConfirm(state, slug)` — verdadeiro só quando o
  carrinho já tem itens **e** pertence a um `slug` diferente.
- `addItem(state, item, restaurant, force)` — sem `force`, tentar adicionar
  de um restaurante diferente **não altera nada** (retorna o estado
  intocado); com `force=true` (só chamado depois que `CartProvider` recebe
  confirmação via `window.confirm`), substitui o carrinho inteiro pelo novo
  restaurante.
- `CartFloatingButton` só aparece quando `cartState.restaurantSlug` bate com
  o restaurante da página atual — evita sugerir que itens de A pertencem à
  página de B.
- A página `/menu/[slug]/carrinho` trata um carrinho de outro restaurante
  como carrinho vazio **para aquela URL** — nunca mostra itens de B na URL
  de A.

## Integração com a UI

- **`ProductCard`** (agora `'use client'`) ganhou botão "Adicionar" real
  (chama `useCart().addItem`), com feedback visual temporário
  ("Adicionado ✓" por ~1.2s). O botão "Em breve" foi removido.
- **`CartFloatingButton`** — novo, mostra `🛒 N itens · R$ subtotal`, fixo
  na tela, link para `/menu/[slug]/carrinho`.
- **`/menu/[slug]/carrinho`** (novo, `'use client'`) — lista de itens com
  imagem/placeholder, preço unitário, controles `+`/`-`, remover, subtotal
  por item e geral, "Limpar carrinho", "Continuar comprando", botão
  "Continuar para checkout" **desabilitado** com `title` explicando que
  chega na próxima fatia (checkout não implementado, como pedido). Empty
  state ("Seu carrinho está vazio" + link de volta) quando não há itens ou
  quando o carrinho pertence a outro restaurante.
- `app/providers.tsx` agora envolve a árvore com `CartProvider`.

## Testes

`lib/cart-logic.test.ts` — 17 casos, 100% sobre a lógica pura (sem DOM
exceto os 2 casos de `localStorage`, que rodam sob `jest-environment-jsdom`):
adicionar produto novo, adicionar produto existente (incrementa), incrementar,
diminuir sem zerar, diminuir até remover, remover explícito, limpar,
quantidade total, subtotal em centavos, persistir + restaurar, storage vazio/
corrompido não quebra, `needsRestaurantSwitchConfirm` (false em carrinho
vazio/mesmo restaurante, true em restaurante diferente com itens), `addItem`
sem `force` não altera carrinho cross-restaurante, `addItem` com `force=true`
substitui completamente (item do restaurante A nunca vaza para o carrinho de
B), A e B nunca compartilham `restaurantSlug`.

Infraestrutura de teste nova no frontend (não existia): `jest.config.js`
usando `next/jest` (preset oficial do Next.js — evita configurar `ts-jest`
manualmente contra o tsconfig do Next), `jest`/`jest-environment-jsdom`/
`@types/jest` adicionados como devDependencies, script `test` em
`apps/web/package.json`.

## Pendências

- Mesma pendência estrutural de sempre (instalação/build reais não
  executados neste ambiente).
- `lib/money.ts` duplica (por design, documentado acima) a lógica de
  `apps/api/.../money.util.ts` — se um dia os dois apps ganharem um pacote
  de runtime compartilhado, esse é o primeiro candidato a migrar para lá.
- Nenhuma pendência de regra de negócio do carrinho em si.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas (sem rede/pnpm install) |
| Testes (`cart-logic.test.ts`, novo `apps/web` Jest) | NÃO EXECUTADO | `jest`/`jest-environment-jsdom` não instalados neste ambiente |
| Build frontend | NÃO EXECUTADO | `next` não instalado |

Revisão manual feita: imports relativos e alias `@/` de todos os arquivos
(novos e editados) resolvidos programaticamente contra o sistema de
arquivos, JSON revalidado, chaves/parênteses de cada arquivo novo
balanceadas, busca explícita por `any` (nenhum encontrado) e por acesso a
`localStorage`/`window` fora de guardas `typeof window` (nenhum encontrado
fora dos pontos já protegidos).

## Próxima fatia

**Checkout** — dados do cliente (nome, telefone, endereço/retirada), forma
de pagamento (placeholder, sem gateway real ainda) e confirmação, preparando
a criação do Pedido no banco a partir do carrinho já validado nesta fatia.

---

# MVP — Fatia 04: Checkout + Criação de Pedido

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo de sempre: código
completo e revisado manualmente; nenhuma instalação/build/teste/migration
executada de fato neste ambiente — ver "Validações" abaixo).

## Regra financeira e de segurança (a mais crítica desta fatia)

O frontend envia **somente** `productId` + `quantity` por item — nenhum
preço, nome, subtotal ou total do carrinho é tratado como autoridade. O
`PublicOrdersService.createOrder`:

1. resolve o `Tenant` exclusivamente por `restaurantSlug` (nunca por
   `tenantId` do cliente — não há JWT nessa rota);
2. carrega todos os produtos pedidos em **uma** query, filtrando
   `tenantId` do tenant resolvido **e** `active: true`;
3. qualquer item cujo `productId` não apareça nesse resultado (inexistente,
   de outro tenant, ou inativo — as três colapsam no mesmo erro, sem
   distinguir motivo) derruba o pedido inteiro;
4. `unitPriceCents`/`productNameSnapshot`/`subtotalCents` de cada
   `OrderItem` vêm **exclusivamente** do `Product` carregado do banco — o
   tipo do DTO (`OrderItemInputDto`) só declara `productId`/`quantity`, então
   um campo `priceCents` enviado pelo cliente é estruturalmente impossível
   de alcançar essa conta (não é só uma checagem em runtime).

**Decisão deliberada sobre `ValidationPipe`:** o endpoint `POST
/v1/public/orders` sobrescreve o `forbidNonWhitelisted: true` global para
`false` (mantendo `whitelist: true`) só nessa rota. Assim, um payload com
campos extras como `priceCents`/`subtotal`/`total` é **aceito e os campos
são silenciosamente descartados antes da validação**, em vez de rejeitar a
requisição inteira com 400 — que é literalmente o comportamento pedido
("o backend DEVE ignorá-los"), não "rejeitar por causa deles". Todas as
outras rotas do sistema mantêm o padrão estrito (`forbidNonWhitelisted: true`).

## Modelos Prisma novos

- **`Order`** — `tenantId`, `orderNumber` (código curto único e amigável,
  gerado por `common/util/order-number.util.ts`, não é sequencial nem
  segredo), `status` (enum `OrderStatus`, sempre `PENDING` na criação;
  enum já inclui os estados futuros do fluxo de cozinha), `customerName`,
  `customerPhone`, `fulfillmentType` (enum `DELIVERY`/`PICKUP`),
  `paymentMethod` (enum `CASH`/`PIX`/`CARD`), `notes?`, campos de endereço
  soltos (`street`/`number`/`complement`/`neighborhood`/`city`/`state`/
  `zipCode`, mesmos nomes usados em `Branch` — só preenchidos quando
  `DELIVERY`, obrigatoriedade validada na aplicação, não como constraint do
  banco), `subtotalCents`/`totalCents` (hoje sempre iguais — sem frete/
  desconto ainda, mas já são colunas separadas para não exigir migration
  quando isso mudar).
- **`OrderItem`** — `productId` (FK `onDelete: Restrict` — um produto já
  pedido nunca pode ser excluído, só desativado) + **snapshot** de
  `productNameSnapshot`/`unitPriceCents` no momento da compra, preservando o
  histórico mesmo que o produto mude de preço/nome depois.
- **Sem `Customer`** — decisão deliberada de manter o MVP simples: pedido
  como convidado, nome/telefone direto no `Order`. Criar uma entidade
  `Customer` fica para uma fatia futura, se/quando precisarmos of
  reconhecer clientes recorrentes.
- Efeito colateral necessário em código já existente:
  `ProductsService.remove()` agora also checa `orderItem.count()` antes de
  excluir um produto, devolvendo `409 PRODUCT_HAS_ORDERS` em vez de deixar
  vazar o erro cru de FK do Postgres — extensão mínima e necessária pelo
  novo relacionamento, não um refactor do módulo.

## Backend

- **`POST /v1/public/orders`** — cria o pedido (`@Public()`, transação
  Prisma: `Order` + `OrderItem[]` num único nested write — se qualquer item
  for inválido, a rejeição acontece **antes** de chamar a transação, então
  nada é escrito; nunca um pedido parcial).
- **`GET /v1/public/orders/:slug/:orderId`** — usado pela página de
  confirmação; também escopado por slug (um `orderId` nunca é legível sob o
  slug de outro tenant — 404 nesse caso).
- Log de auditoria (`ORDER_CREATED`) best-effort, igual ao resto do sistema.

## Frontend

- **`/menu/[slug]/checkout`** — resumo do pedido (a partir do `CartContext`,
  só para exibição), formulário de nome/telefone, seleção Entrega/Retirada
  (endereço só aparece para Entrega), forma de pagamento (placeholder —
  nenhuma cobrança processada, aviso explícito na tela), observação
  opcional. Validação client-side antes do envio (não substitui a do
  backend). Ao confirmar: `clearCart()` + redirecionamento para a
  confirmação. Erros do backend (produto indisponível, endereço faltando
  etc.) aparecem inline.
- **`/menu/[slug]/pedido/[orderId]`** — Server Component (mesmo padrão do
  cardápio público), com `loading.tsx`/`not-found.tsx` dedicados (o
  `not-found.tsx` do cardápio diria "restaurante não encontrado", mensagem
  errada para "pedido não encontrado" — por isso um específico para esta
  rota). Mostra número, status, itens, total, atendimento, endereço quando
  aplicável, pagamento e observação.
- Botão "Continuar para checkout" do carrinho, antes desabilitado, agora
  navega de verdade para o checkout.
- `lib/checkout-api.ts` — reaproveita o `apiFetch` já existente; o tipo
  `CreateOrderInput` só permite `{productId, quantity}` por item no nível de
  TypeScript, reforçando a regra crítica também do lado do frontend.

## Testes

`apps/api/test/public-orders.e2e-spec.ts`, 13 casos: pedido PICKUP com
cálculo correto, pedido DELIVERY com endereço, DELIVERY sem endereço (400),
PICKUP sem endereço (sucesso), produto inexistente (400), produto inativo
(400), produto de outro tenant sob o slug errado (400), quantidade inválida
— zero/negativa/acima do limite (400 nos três), itens vazios (400), slug
inexistente com payload bem formado (404, diferenciado de payload malformado
= 400), **teste OBRIGATÓRIO de adulteração de preço** (cliente envia
`priceCents`/`price`/`subtotal`/`total` forjados junto com `productId`/
`quantity` legítimos — backend deve ignorar tudo isso e usar o preço real do
banco; testado explicitamente que a resposta reflete R$ 29,90, não o valor
forjado), `GET /public/orders/:slug/:orderId` retorna o pedido, e retorna
404 quando consultado sob o slug de outro tenant.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| Prisma validate/generate | NÃO EXECUTADO | ambiente sem `pnpm install`/rede |
| Migration (Order/OrderItem) | NÃO EXECUTADO | requer PostgreSQL real |
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas |
| Testes (`public-orders.e2e-spec.ts`) | NÃO EXECUTADO | idem + requer Postgres real |
| Build frontend/backend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports relativos e alias `@/` de todos os arquivos
novos/editados resolvidos programaticamente, JSON revalidado, chaves de
`schema.prisma` e do novo teste e2e balanceadas, busca explícita por `any`
(nenhum encontrado), nenhuma dependência nova necessária (class-validator/
class-transformer/crypto já existiam).

## Pendências

- Mesma pendência estrutural de sempre (migration real ainda não gerada —
  agora inclui `Order`/`OrderItem` além do que já estava pendente).
- Nenhuma pendência de regra de negócio conhecida dentro do escopo desta
  fatia.

## Próxima fatia

**Painel de pedidos** (visão administrativa, autenticada, dos pedidos
recebidos por tenant — leitura + mudança de status), completando o loop
cliente→pedido→restaurante antes de qualquer integração de pagamento real,
KDS ou PDV.

---

# Correção — Redução de exposição de dados pessoais na confirmação pública

**Contexto:** `GET /v1/public/orders/:slug/:orderId` (fatia 04) não tem
autenticação nem token secreto — qualquer pessoa com o `orderId` (link
compartilhado, histórico do navegador, adivinhação) consegue chamá-lo.
A resposta incluía `customerPhone` e `customerName`, que a página de
confirmação **nunca renderiza** — exposição desnecessária de dado pessoal
numa rota pública.

## O que foi alterado

- **`apps/api/src/modules/public-orders/dto/order-response.dto.ts`** — novo
  `PublicOrderConfirmationDto`, idêntico a `OrderResponseDto` **menos**
  `customerName` e `customerPhone`. `OrderResponseDto` (usado só pelo
  `POST /public/orders`, devolvido de forma síncrona ao próprio navegador
  que acabou de enviar esses dados) permanece intocado.
- **`public-orders.service.ts`** — `findPublicOrder()` agora retorna
  `PublicOrderConfirmationDto`. Implementado reaproveitando `toDto()`
  (nenhuma lógica de mapeamento duplicada) e removendo os dois campos por
  destructuring (`const { customerName, customerPhone, ...confirmation } =
  this.toDto(order); return confirmation;`) — visivelmente explícito sobre
  o que é descartado, no próprio ponto de retorno.
- **`public-orders.controller.ts`** — assinatura de `getOrder()` atualizada
  para `Promise<PublicOrderConfirmationDto>`.
- **`packages/eslint-config/index.js`** — adicionado `ignoreRestSiblings:
  true` à regra `no-unused-vars` (necessário para o padrão acima não gerar
  aviso de lint; é a opção padrão do ESLint feita exatamente para "omitir
  campos via destructuring").
- **`apps/web/lib/checkout-api.ts`** — novo tipo `PublicOrderConfirmation =
  Omit<OrderResponse, 'customerName' | 'customerPhone'>`; `getOrder()` agora
  retorna esse tipo mais estreito. `OrderResponse` (usado por `createOrder()`)
  não mudou.
- **Página de confirmação (`/menu/[slug]/pedido/[orderId]`) — nenhuma
  alteração necessária**: ela nunca leu `customerName`/`customerPhone`, só
  `orderNumber`/`status`/`items`/`total`/`fulfillmentType`/`address`/
  `paymentMethod`/`notes` — todos preservados no novo DTO. Funcionamento
  idêntico, confirmado por inspeção antes de alterar qualquer coisa.

## Dados removidos da resposta pública

- `customerName`
- `customerPhone`

**Mantidos** (necessários para a página funcionar, não são dado pessoal
sensível equivalente): endereço de entrega completo (é o propósito da
página — confirmar para onde vai a entrega), itens, valores, status, forma
de pagamento, observação, `createdAt`.

## Testes atualizados

`apps/api/test/public-orders.e2e-spec.ts`:

- Teste existente de `GET /public/orders/:slug/:orderId` ampliado para
  confirmar que tudo que a página de confirmação renderiza continua
  presente (`status`, `items`, `total`, `fulfillmentType`, `paymentMethod`).
- **Novo teste obrigatório**: cria um pedido com nome/telefone
  identificáveis, confirma que a resposta do `POST` (create) legitimamente
  os contém, e então confirma que a resposta do `GET` **não tem** as
  propriedades `customerName`/`customerPhone` e que o telefone/nome não
  aparecem em lugar nenhum do JSON serializado da resposta (checagem por
  substring, não só por chave, para pegar qualquer vazamento acidental).

## Pendências

- Nenhuma pendência nova introduzida por esta correção.
- Autenticação da página de confirmação e/ou um `publicOrderToken`
  dedicado (para tornar o link em si não-adivinhável) ficam para uma fase
  futura, por instrução explícita — esta correção só reduz o que a rota
  *retorna*, não quem consegue *chamá-la*.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas neste ambiente |
| Testes (`public-orders.e2e-spec.ts`) | NÃO EXECUTADO | requer Postgres real, indisponível aqui |
| Build backend/frontend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports/alias `@/` resolvidos programaticamente, JSON
revalidado, chaves/parênteses de todos os arquivos alterados balanceadas,
confirmado por grep que `customerName`/`customerPhone` não aparecem mais em
nenhum ponto do fluxo de leitura pública (controller e página de
confirmação).

---

# MVP — Fatia 05: Painel Administrativo de Pedidos

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo de sempre: código
completo e revisado manualmente; nenhuma instalação/build/teste executada
de fato neste ambiente — ver "Validações" abaixo).

## Backend

- Novo módulo `orders` (distinto de `public-orders` — este é autenticado),
  reaproveitando os modelos `Order`/`OrderItem` já existentes (nenhum
  modelo duplicado) e os DTOs `OrderItemResponseDto`/`OrderAddressResponseDto`
  de `public-orders` (import direto, mesmo app — nenhuma duplicação de
  regra de mapeamento).
- **`GET /v1/orders`** — paginado (`page`/`pageSize`, cap de 100),
  filtrável por `status`, ordenado por `createdAt desc`. Retorna só o
  necessário para a lista (inclusive `itemCount` via `_count`, sem carregar
  os itens completos — "não carregar dados desnecessários").
- **`GET /v1/orders/:id`** — detalhe completo, itens vindos de `OrderItem`
  (nome/preço no momento da compra), **nunca** uma nova consulta a
  `Product` — testado explicitamente (troquei nome/preço do produto DEPOIS
  de criar o pedido e confirmei que o detalhe continua mostrando o valor
  pago originalmente).
- **`PATCH /v1/orders/:id/status`** — aceita **somente** `{status}`;
  `ValidationPipe` global (`forbidNonWhitelisted: true`, sem override aqui
  — diferente do endpoint público de checkout) rejeita qualquer outro campo.
- `tenantId` sempre do JWT via `@CurrentUser()` — todas as três rotas.
- RBAC reaproveitando os guards existentes, sem nova arquitetura:
  `orders.read` (listar/detalhar), `orders.update` (mudar status).
  `orders.cancel` tratado como sub-permissão: uma transição **para**
  `CANCELLED` exige adicionalmente `orders.cancel` (checado no service, não
  só no guard da rota) — então um papel com `orders.update` mas sem
  `orders.cancel` consegue avançar o fluxo normal mas não cancelar.
  `MANAGER` ganhou `orders.cancel` no seed (só tinha `orders.read`/
  `orders.update` antes) para poder concluir o critério de aceite completo.
  `OWNER`/`ADMIN` já tinham tudo. Nenhuma mudança na arquitetura de
  guards/decorators.
- **Transições de status** — `order-status.util.ts`, função pura
  (`isValidOrderStatusTransition`): `PENDING→{CONFIRMED,CANCELLED}`,
  `CONFIRMED→{PREPARING,CANCELLED}`, `PREPARING→{READY,CANCELLED}`,
  `READY→{COMPLETED}`, `CANCELLED`/`COMPLETED` sem saída. `OUT_FOR_DELIVERY`/
  `DELIVERED` (do enum da fatia 04) não têm entrada no mapa — qualquer
  transição envolvendo eles cai no `?? []` e é rejeitada, sem precisar de
  um enum menor só para isso.
- **Auditoria** — `ORDER_STATUS_CHANGED` gravado a cada mudança
  (`userId`, `tenantId`, `entityId`, status anterior/novo em
  `beforeData`/`afterData`), reaproveitando o `AuditService` existente.

## Frontend

- **`/dashboard/pedidos`** — abas Todos/Novos/Confirmados/Preparando/
  Prontos/Concluídos, contador de pedidos, cards (`OrderCard.tsx` +
  `StatusBadge.tsx` compartilhado com o detalhe), loading/empty/error
  states, botão "Atualizar" manual. Atualização automática via
  **TanStack Query** (`refetchInterval` de 15s) — primeiro uso real da
  biblioteca no projeto (estava instalada desde a Fase 01 mas nunca usada
  de fato); atende "sem WebSocket, polling moderado" sem introduzir nenhuma
  biblioteca de estado nova.
- **`/dashboard/pedidos/[id]`** — todos os campos pedidos (cliente,
  telefone, endereço quando entrega, pagamento, observação, itens,
  subtotal/total), um "histórico simples" na forma de stepper linear
  (Recebido→Confirmado→Preparando→Pronto→Concluído, com o passo atual
  destacado; `CANCELADO` sai da linha e mostra um aviso à parte), e os
  botões de ação corretos por status (`PENDING`: Confirmar/Cancelar;
  `CONFIRMED`: Iniciar preparo/Cancelar; `PREPARING`: Marcar como
  pronto/Cancelar; `READY`: Finalizar; `COMPLETED`/`CANCELLED`: nenhuma
  ação). Mutação via `useMutation`, invalida as queries de detalhe e de
  lista no sucesso; erro do backend (ex. transição inválida, 403 de
  permissão) aparece inline.
- Link "Pedidos" adicionado ao `/dashboard`; texto do rodapé do dashboard e
  da home atualizado (não citavam mais a realidade do projeto).

## Testes

`apps/api/src/modules/orders/order-status.util.spec.ts` — unitário, sem
banco: todas as transições válidas, uma amostra de saltos inválidos, os
dois estados terminais nunca saem do lugar, e as transições envolvendo
`OUT_FOR_DELIVERY`/`DELIVERED` são rejeitadas.

`apps/api/test/orders-admin.e2e-spec.ts` — 10 casos: listagem ordenada por
`createdAt desc`, filtro por status, paginação (`meta` correto), detalhe
com snapshot histórico (preço/nome do produto alterados depois não afetam
o pedido já feito), fluxo completo válido
`PENDING→CONFIRMED→PREPARING→READY→COMPLETED`, salto inválido (`PENDING→
COMPLETED`, 409) e saída de estado terminal (`CANCELLED→CONFIRMED`, 409),
log de auditoria gravado corretamente, **isolamento de tenant** (tenant A
não lista/lê/atualiza pedido de tenant B — 404 nos dois últimos casos),
e — preenchendo uma lacuna que a Fase 01 já tinha registrado como
pendente — um teste de autorização real: um usuário `WAITER` (criado via
inserção direta no Prisma + login real, já que não existe endpoint de
convite de usuário) consegue listar pedidos mas recebe `403` ao tentar
mudar status; um `MANAGER` consegue mudar status e cancelar.

## Pendências

- Mesma pendência estrutural de sempre (nenhuma execução real neste
  ambiente).
- Nenhuma pendência de regra de negócio conhecida dentro do escopo desta
  fatia.
- Ainda não existe endpoint de convite/criação de usuário com papel
  restrito — os testes de autorização desta fatia precisaram inserir o
  usuário de teste diretamente via Prisma. Isso deve virar uma fatia própria
  quando o painel de gestão de equipe for implementado.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| Prisma validate/generate | NÃO EXECUTADO | ambiente sem `pnpm install`/rede |
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas |
| Testes (unit + `orders-admin.e2e-spec.ts`) | NÃO EXECUTADO | idem + requer Postgres real |
| Build backend/frontend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports relativos e alias `@/` resolvidos
programaticamente, JSON revalidado, chaves/parênteses de todos os arquivos
novos balanceadas, busca explícita por `any` no frontend novo (nenhum
encontrado), nenhuma dependência nova necessária (TanStack Query já estava
instalada desde a Fase 01).

## Próxima fatia

**KDS (Kitchen Display System)** — visão da cozinha focada em
`PREPARING`/`READY`, provavelmente reaproveitando os mesmos endpoints
`GET /v1/orders?status=...` e `PATCH /v1/orders/:id/status` já
implementados nesta fatia, sem precisar de backend novo.

---

# MVP — Fatia 06: KDS (Kitchen Display System)

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo de sempre: código
completo e revisado manualmente; nenhuma instalação/build/teste executada
de fato neste ambiente — ver "Validações" abaixo).

## Backend — nenhum endpoint novo, uma extensão aditiva

Conforme pedido explicitamente ("reutilizar `GET /v1/orders` e `PATCH
/v1/orders/:id/status`, não criar endpoints específicos"), o KDS não tem
backend próprio. A única mudança no backend foi **aditiva** ao endpoint de
listagem já existente (fatia 05): `OrderListItemDto` ganhou `items` (itens
com nome/quantidade, a partir do snapshot em `OrderItem` — nunca uma nova
consulta a `Product`) e `notes`, porque o card do KDS precisa dos dois e a
listagem administrativa antes só devolvia `itemCount`. `itemCount`
continua existindo — a página `/dashboard/pedidos` da fatia 05 não muda em
nada. Essa decisão evita N+1 requisições: sem isso, o KDS precisaria de uma
chamada `GET /orders/:id` por card, potencialmente dezenas a cada 5s.
Mapeamento de item extraído para um método privado único (`toItemDto`),
compartilhado entre a listagem e o detalhe — não duplica a regra.

`KITCHEN` já tinha `orders.read`/`orders.update` no seed desde a Fase 01 —
nenhuma mudança de permissão foi necessária para esta fatia.

## Frontend

- **`/dashboard/cozinha`** — 4 colunas (Novos=`PENDING`,
  Confirmados=`CONFIRMED`, Preparando=`PREPARING`, Prontos=`READY`; grid
  responsivo, 1 coluna no celular até 4 em telas maiores, cada coluna rola
  independentemente). `COMPLETED`/`CANCELLED` nunca aparecem aqui.
- **Atualização**: 4 `useQuery` do TanStack Query em paralelo (um por
  status), `refetchInterval: 5000`. Ação de mudar status usa `useMutation`
  + invalidação das 4 queries do KDS e também das da fatia 05 (`['orders']`),
  para as duas telas ficarem consistentes se abertas ao mesmo tempo.
- **`KdsOrderCard.tsx`** — número, tempo decorrido (calculado no cliente a
  partir de `createdAt`, via hook `useElapsedMinutes` com re-render a cada
  15s — nada salvo no banco), tipo de atendimento, itens com quantidade,
  observação, um botão de ação grande por status
  (Aceitar/Iniciar preparo/Marcar como pronto/Finalizar). **Sem telefone e
  sem endereço** — a cozinha não precisa disso. Borda vermelha quando um
  pedido não-`READY` passa de 15 min de espera.
- **Som**: hook `useOrderSound` sintetiza um beep via Web Audio API (sem
  dependência externa), com um botão explícito "Ativar som" — o
  `AudioContext` só é criado/retomado dentro desse clique, respeitando a
  política de autoplay dos navegadores. Ao detectar um `id` novo na lista
  de `PENDING` (comparado com a leitura anterior, guardada em `useRef`) o
  som toca; a primeira carga da tela só define a base de comparação, nunca
  dispara som para pedidos que já estavam lá.
- Link "Cozinha (KDS)" no `/dashboard`, mostrado apenas para
  `OWNER`/`ADMIN`/`MANAGER`/`KITCHEN` (checagem de UX, não de segurança — a
  garantia real continua sendo o `orders.read`/`orders.update` do backend).

## Testes

- `apps/api/test/orders-admin.e2e-spec.ts` — a asserção antiga
  `not.toHaveProperty('items')` no teste de listagem (que agora estaria
  **errada**, já que `items` passou a existir de propósito) foi corrigida
  para confirmar a nova forma da resposta.
- **`apps/api/test/kds.e2e-spec.ts`** (novo, 2 casos) — cobre só o que é
  genuinamente novo nesta fatia: um usuário `KITCHEN` consegue listar por
  status (com `items`/`notes` presentes) e percorrer o fluxo completo até
  `COMPLETED`; e confirma que `KITCHEN` **não** consegue cancelar (tem
  `orders.update` mas não `orders.cancel`, testando a granularidade da
  permissão para este papel específico).
- **Deliberadamente não duplicado**: isolamento de tenant e rejeição de
  transição inválida em `GET /orders`, `GET /orders/:id` e `PATCH
  /orders/:id/status` já estão cobertos, endpoint a endpoint, por
  `orders-admin.e2e-spec.ts` (fatia 05) — como o KDS reutiliza exatamente
  essas rotas sem alterá-las, essa proteção já vale para o KDS também, sem
  precisar reescrever os mesmos testes com outro nome.

## Pendências

- Mesma pendência estrutural de sempre (nenhuma execução real neste
  ambiente).
- Não existe teste cobrindo "usuário sem `orders.read` não consegue
  listar" com um usuário real: **todos** os papéis do seed atual (incluindo
  `VIEWER`/`DELIVERY`) têm `orders.read` — não há como criar esse cenário
  sem inventar um papel novo fora do escopo desta fatia. O mecanismo do
  guard em si (`PermissionsGuard`) já tem cobertura unitária própria desde
  a Fase 01.
- Preferência de som ("Ativar som") não persiste entre recarregamentos de
  página — reseta a cada abertura da tela, por simplicidade (não pedido
  explicitamente que persista).

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas neste ambiente |
| Testes (`kds.e2e-spec.ts` + `orders-admin.e2e-spec.ts` atualizado) | NÃO EXECUTADO | requer Postgres real, indisponível aqui |
| Build backend/frontend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports relativos e alias `@/` resolvidos
programaticamente, JSON revalidado, chaves/parênteses de todos os arquivos
novos/editados balanceadas, busca explícita por `any` no frontend novo
(nenhum encontrado), um import não utilizado (`useState`) encontrado e
removido do `cozinha/page.tsx`, um `Record<OrderStatus,...>` com entradas
fictícias substituído por uma estrutura mais limpa. Nenhuma dependência
nova necessária.

## Próxima fatia

**PDV (Ponto de Venda)** — criação de pedidos presenciais diretamente pela
equipe (sem passar pelo cardápio público/carrinho do cliente), provavelmente
reaproveitando boa parte da lógica de cálculo de `PublicOrdersService`
adaptada para um fluxo autenticado.

---

# MVP — Fatia 07: PDV de Balcão

**Status: CONCLUÍDA COM PENDÊNCIAS** (mesmo motivo de sempre: código
completo e revisado manualmente; nenhuma instalação/build/teste/migration
executada de fato neste ambiente — ver "Validações" abaixo).

## Arquitetura — camada de domínio extraída

Análise prévia (pedida explicitamente) confirmou que criar o PDV do zero
duplicaria exatamente a lógica financeira crítica do checkout público
(validar tenant/produtos, recalcular preço do banco, calcular subtotal,
criar `Order`+`OrderItem` numa transação). Extraído para:

- **`OrderCreationService`** (módulo novo `order-creation`) — dono único
  dessas regras agora. `PublicOrdersService` (fatia 04) virou um adaptador
  fino: só resolve o tenant pelo `slug` e chama esse serviço com
  `source: 'ONLINE'`. `PosOrdersService` (novo) resolve o tenant pelo JWT e
  chama o mesmo serviço com `source: 'COUNTER'`. Nenhuma regra financeira
  existe em dois lugares.
- Origem do pedido definida **sempre pelo backend**, nunca aceita do
  cliente em nenhum dos dois fluxos — `dto.items` (público e PDV) só
  expõe `productId`/`quantity` na tipagem, tornando estruturalmente
  impossível o cliente influenciar preço/origem.

## Modelo de dados

- **`OrderSource`** (`ONLINE`/`COUNTER`) — novo enum, campo `Order.source`
  com `@default(ONLINE)`. Nada muda no comportamento das fatias
  anteriores: `PublicOrdersService` sempre passa `ONLINE` explicitamente.
- **`Order.customerName`/`customerPhone`** — passaram de `String` para
  `String?`. Uma venda de balcão pode não ter identificação nenhuma;
  pedidos online continuam sempre preenchendo os dois (`CreateOrderDto`
  do checkout público continua exigindo `customer.name`/`customer.phone`
  — nada muda ali). `OrderResponseDto`/`PublicOrderConfirmationDto` (fatia
  04) continuam `string` não-nulo — só as DTOs administrativas
  (`OrderListItemDto`/`OrderDetailDto`, fatia 05) viraram `string | null`,
  porque só elas podem exibir um pedido de balcão.
- `docs/database.md` corrigido — não dizia mais que `Order`/`OrderItem`
  "chegam nas fases posteriores" (estavam desatualizados desde a fatia 04).

## Backend

- **`POST /v1/pos/orders`** (autenticado, `@RequirePermissions('pos.create')`)
  — payload mínimo exato pedido: `items[{productId,quantity}]`,
  `customerName?`, `customerPhone?`, `paymentMethod`. Sem
  `fulfillmentType`/`address` no payload — uma venda de balcão é sempre
  tratada como `PICKUP` internamente (o cliente está fisicamente no
  balcão), decidido pelo backend, nunca pelo cliente. `tenantId` sempre do
  JWT. **Sem override do `ValidationPipe` global** (diferente do checkout
  público) — um campo desconhecido no payload (ex. `priceCents`) é
  rejeitado com `400`, mais forte que "ignorado", e consistente com todo
  resto da API autenticada.
- **Catálogo do PDV**: reaproveita `GET /v1/products`/`GET /v1/categories`
  já existentes (fatia 01) — nenhum endpoint novo. `CASHIER` ganhou
  `products.read`/`categories.read` no seed (não tinha). O filtro
  "somente produtos ativos" acontece no frontend (o endpoint precisa
  continuar retornando inativos também, para a tela administrativa de
  cardápio da fatia 01 seguir funcionando).
- **Permissões novas**: `pos.read`, `pos.create`. Acesso inicial:
  `OWNER`/`ADMIN` (automático, têm tudo), `MANAGER` e `CASHIER` (ambos
  ganharam `pos.*` explicitamente no seed).
- Pedido de balcão aparece no **mesmo** `GET /v1/orders`/`GET /v1/orders/:id`
  usados pelo painel (fatia 05) e pelo KDS (fatia 06) — nenhum tratamento
  especial, exatamente como pedido; a única diferença visível é o campo
  `source`.

## Frontend

- **`/dashboard/pdv`** — catálogo (busca por nome + filtro de categoria,
  só produtos ativos), carrinho **próprio e local** (não é o
  `CartContext`/`localStorage` do cardápio público — estado começa vazio
  sempre, resetado a cada venda), cliente opcional, seleção de forma de
  pagamento, botão grande "FINALIZAR VENDA". Confirmação com número do
  pedido + "Nova venda" (reseta tudo) + link para o pedido no painel.
  Layout dois-painéis (catálogo + venda atual) empilhando em telas
  menores, botões grandes para touchscreen.
- **`lib/pos-logic.ts`** — lógica pura do carrinho do PDV
  (`addToCart`/`incrementItem`/`decrementItem`/`removeItem`/subtotal/
  quantidade) e `filterPosProducts` (busca+categoria+ativo). Deliberadamente
  **não** reaproveita `lib/cart-logic.ts` (o carrinho público): aquele
  módulo embute o conceito de `restaurantSlug`/troca de restaurante, que
  não existe aqui (o tenant do usuário logado É o restaurante) — reaproveitar
  traria campos irrelevantes. Reaproveitar automaticamente teria sido mais
  simples de escrever, mas errado dado o pedido explícito de estado próprio.
- **`OrderCard.tsx`** e a página de detalhe do pedido (fatia 05) ganharam um
  badge "Online"/"Balcão" e um fallback "Cliente balcão" para quando
  `customerName` é nulo — extensão mínima, não uma reescrita dessas telas.
- Link "PDV (balcão)" no `/dashboard`, mostrado para
  `OWNER`/`ADMIN`/`MANAGER`/`CASHIER` (checagem de UX, a garantia real
  continua sendo `pos.create` no backend).

## Testes

- **`apps/api/test/pos.e2e-spec.ts`** (novo, 9 casos): `CASHIER` enxerga o
  catálogo via os endpoints já existentes; criação com cálculo correto e
  `source=COUNTER` confirmado através do **mesmo** `GET /orders/:id` do
  painel; identificação de cliente opcional aceita; um pedido `ONLINE` e um
  `COUNTER` do mesmo tenant aparecem distinguidos na listagem; produto
  inexistente/inativo/de outro tenant rejeitados (pedido inteiro falha);
  quantidade inválida e carrinho vazio rejeitados; **teste obrigatório de
  adulteração de preço** (`priceCents`/`subtotal`/`total` no payload →
  `400`, rejeitado pelo whitelist estrito, não apenas ignorado);
  isolamento de tenant (CASHIER de A não usa produto de B); papel sem
  `pos.create` (`WAITER`) recebe `403`.
- **`apps/web/lib/pos-logic.test.ts`** (novo, 14 casos): toda a lógica de
  carrinho do PDV (adicionar/incrementar/decrementar até remover/remover/
  subtotal/quantidade) e `filterPosProducts` (exclusão de inativos, busca,
  categoria, combinação dos dois, e confirmação de que um produto inativo
  nunca aparece mesmo quando bate com busca+categoria).
- Não escrevi um teste de renderização de componente para a página do PDV
  em si (só a lógica pura) — consistente com o padrão já usado nas fatias
  03/04 (testar a lógica extraída, não o componente React montado).

## Pendências

- Mesma pendência estrutural de sempre (nenhuma execução real neste
  ambiente).
- Nenhuma pendência de regra de negócio conhecida dentro do escopo desta
  fatia.
- Igual às fatias 05/06: sem endpoint de convite de usuário, os testes de
  permissão continuam inserindo o usuário de teste diretamente via Prisma.

## Validações

| Verificação | Resultado | Motivo |
|---|---|---|
| Prisma validate/generate | NÃO EXECUTADO | ambiente sem `pnpm install`/rede |
| Migration (`OrderSource`, `customerName`/`Phone` nuláveis) | NÃO EXECUTADO | requer PostgreSQL real |
| TypeScript / ESLint | NÃO EXECUTADO | dependências não instaladas |
| Testes (`pos.e2e-spec.ts` + `pos-logic.test.ts`) | NÃO EXECUTADO | idem + requer Postgres real (backend) |
| Build backend/frontend | NÃO EXECUTADO | `next`/`@nestjs/cli` não instalados |

Revisão manual feita: imports relativos e alias `@/` de todos os arquivos
novos/editados resolvidos programaticamente contra o sistema de arquivos,
JSON revalidado, chaves de `schema.prisma` e de todos os arquivos novos
balanceadas, busca explícita por `any` no frontend novo (nenhum
encontrado), nenhuma dependência nova necessária.

## Próxima fatia

**Caixa** (abertura/fechamento, sangria, suprimento) — natural próximo
passo depois do PDV, para dar controle financeiro sobre o dinheiro que
entra por `CASH` nas vendas de balcão e, futuramente, também sobre os
pedidos online pagos na entrega/retirada.

---

# Rodada de Hardening (pós-Fatia 07)

Rodada curta, sem nova feature grande — correções pontuais + planejamento
da próxima fatia.

## 1. Correção: cache do TanStack Query vazando entre sessões/tenants

**Problema**: `AuthProvider` nunca limpava o `QueryClient` ao trocar de
sessão. Como as queries administrativas (`['pdv-products']`,
`['pdv-categories']`, `['orders', tab]`, `['kds-orders', status]`, etc.)
não carregam `tenantId` na própria chave, um logout seguido de login como
usuário de **outro tenant**, sem recarregar a página, podia mostrar por um
instante dados em cache do tenant anterior antes do novo fetch resolver.

**Correção** (`apps/web/lib/auth-context.tsx`): `AuthProvider` agora chama
`useQueryClient()` (já é filho de `QueryClientProvider` em
`app/providers.tsx`) e executa `queryClient.clear()` em **login**,
**register** e **logout** — os três pontos onde a identidade autenticada
muda. `login`/`register` limpam o cache **antes** de definir o novo token,
garantindo que nenhuma query da sessão nova possa herdar dado da anterior.
Solução deliberadamente simples: `clear()` no nível do provedor de auth, não
uma reestruturação de chaves de query por `tenantId` em cada tela.

**Cobertura confirmada**: PDV (`pdv-products`/`pdv-categories`), painel de
pedidos (`orders`), KDS (`kds-orders`), detalhe de pedido (`order`) — todas
essas chaves vivem no mesmo `QueryClient` que `AuthProvider` agora limpa;
nenhuma configuração adicional foi necessária por tela.

## 2. Documentação

- Topo do `PROJECT_STATUS.md` já refletia corretamente a Fatia 07 como a
  mais recente, com 01–07 em ordem (confirmado, nenhuma correção
  necessária ali).
- Duas referências desatualizadas corrigidas: `apps/web/app/page.tsx`
  (home) e `apps/web/app/dashboard/page.tsx` (rodapé) ainda diziam que
  "PDV chega nas próximas fatias" / "PDV, caixa e cozinha (KDS) chegam nas
  próximas fatias" — ambos já existem desde as fatias 06/07. Textos
  atualizados para refletir o estado real (só Caixa ainda pendente).

## 3. Plano do Caixa

Criado **`docs/CASH_REGISTER_PLAN.md`** — planejamento completo da Fatia
08 (`CashRegisterSession`/`CashMovement`, abertura/fechamento, sangria/
suprimento, cálculo de saldo esperado vs. contado e diferença de caixa,
regras transacionais/concorrência/idempotência, permissões, isolamento por
tenant, relação com o PDV, endpoints e telas previstos, testes críticos e
critérios de aceite). **Nada foi implementado** — é só o documento.

## 4. Checagem rápida (Fatia 07)

Imports relativos e alias `@/` de todo o repositório resolvidos
programaticamente, JSON revalidado, arquivos principais da fatia 07
confirmados presentes. **Nenhum problema encontrado.**

## Validações desta rodada

| Verificação | Resultado | Motivo |
|---|---|---|
| Imports/JSON (checagem estática) | PASSOU | revisão manual programática, sem erros encontrados |
| TypeScript / ESLint / testes / build | NÃO EXECUTADO | ambiente sem `pnpm install`/rede/Postgres, como em todas as fatias anteriores |

## Próxima fatia

**Caixa** — implementação a partir de `docs/CASH_REGISTER_PLAN.md`.

---

# MVP — Fatia 08: Caixa

**Status: CONCLUÍDA COM PENDÊNCIAS** — código completo e revisado; a
lógica financeira pura foi **compilada (tsc strict) e executada de verdade**
neste ambiente, mas install/migrate/testes e2e/build continuam impossíveis
aqui (registry npm → HTTP 403, sem pnpm/Docker/Postgres). Detalhes de
arquitetura: `docs/CASH_REGISTER_PLAN.md` → "Decisões tomadas na
implementação".

## Decisão de Branch (resumo)

`branchId` explícito por requisição, revalidado sempre por
`BranchAccessService` (tenant do JWT + OWNER/ADMIN ou `UserBranch`).
`Order.branchId` passou a ser **obrigatório**: PDV usa o validado; online usa
a branch padrão do tenant (MATRIZ). Nova rota `GET /v1/branches/accessible`.

## Modelos / migrations

- `Order.branchId` (+ relação `Branch`, índice `(tenantId, branchId, createdAt)`).
- `CashRegisterSession` (`CashSessionStatus` OPEN/CLOSED) e `CashMovement`
  (`CashMovementType` WITHDRAWAL/SUPPLY/SALE, `orderId @unique`).
- `prisma/sql/cash_register_constraints.sql` (índice único parcial de 1
  sessão OPEN por tenant+branch + trigger de imutabilidade), aplicado por
  **`pnpm db:constraints`** logo após `pnpm db:migrate`.
- Migrations Prisma continuam **não geradas** (mesma pendência estrutural de
  sempre); a primeira `prisma migrate dev` num ambiente real já incluirá tudo.

## Endpoints (todos autenticados)

`POST /v1/cash/sessions` (cash.open) · `GET /v1/cash/sessions/current?branchId=`
(cash.read) · `GET /v1/cash/sessions` (cash.read, restrito às unidades
acessíveis) · `GET /v1/cash/sessions/:id` (cash.read) ·
`POST /v1/cash/sessions/:id/movements` (cash.movement.create; só SUPPLY/
WITHDRAWAL — SALE é exclusivo do backend) · `PATCH /v1/cash/sessions/:id/close`
(cash.close; aceita **só** `countedClosingBalanceCents` + `notes`).
Alterados: `POST /v1/pos/orders` (exige `branchId`; CASH exige caixa aberto),
`GET /v1/orders` (novo filtro opcional `branchId`; `branchId` nas respostas).

## Integração PDV

CASH: valida branch → transação { trava sessão OPEN da branch → cria Order →
cria SALE (`amountCents = Order.totalCents`) } → sucesso. Sem sessão:
`409 CASH_REGISTER_NOT_OPEN`, nada persiste. PIX/CARD: só o Order.
`OrderCreationService` continua sendo o único dono da criação de pedidos
(o gancho de caixa entrou nele, não em um serviço paralelo).

## Frontend

`/dashboard/caixa` (status, saldo inicial, vendas em dinheiro, suprimentos,
sangrias, saldo esperado ao vivo, abrir/suprimento/sangria/fechar, resumo
pós-fechamento com esperado/contado/diferença, histórico com data/tipo/
valor/motivo/usuário/pedido), seletor de unidade (`useActiveBranch` +
`BranchSelector`, também no PDV), mensagem acionável no PDV para
`CASH_REGISTER_NOT_OPEN`, link "Caixa" no dashboard.

## Testes

- `apps/api/test/cash.e2e-spec.ts` (novo, 17 casos) — cobre os 23 itens
  exigidos: abertura, 2ª abertura bloqueada, saldo inicial, suprimento,
  sangria, motivo obrigatório, SALE em CASH, nenhum SALE em PIX/CARD, CASH
  sem caixa rejeitado sem persistir nada, fechamento, saldo esperado,
  diferença, sessão fechada sem movimentos / sem refechar / venda CASH
  falha, movimento não editável/excluível (sem rota + trigger no banco),
  idempotência de SALE (unique), isolamento de tenant, isolamento de branch
  (CASHIER vinculado só à unidade 1), RBAC, **concorrência de abertura**
  (3 simultâneas → exatamente 1× 201) e **de fechamento** (2 simultâneos →
  exatamente 1× 200), tentativa de enviar expected/difference (400), e
  auditoria (OPENED/MOVEMENT_CREATED/CLOSED com valores calculados).
- `apps/api/test/pos.e2e-spec.ts` reescrito para `branchId` + regras de
  caixa (inclui branch de outro tenant → 404, branch não vinculada → 403).
- Unitários: `cash-calculations.spec.ts` (api) e `lib/cash-api.test.ts` (web).
- Helpers e2e compartilhados em `test/test-app.util.ts`
  (`registerTenantE2E`, `createActiveProductE2E`, `createStaffAndLoginE2E`
  com `UserBranch`).

## Validações

| Verificação | Resultado | Detalhe |
|---|---|---|
| `pnpm install` | NÃO EXECUTADO | registry.npmjs.org → HTTP 403 (egress bloqueado); `npx pnpm` também 403 |
| `db:generate` / `db:migrate` / `db:seed` / `db:constraints` | NÃO EXECUTADO | sem dependências e sem PostgreSQL/Docker |
| `pnpm typecheck` (projeto inteiro) | NÃO EXECUTADO | sem `node_modules` |
| `tsc --strict` nos arquivos puros (`cash-calculations.ts`, `cash-api.ts`, `pos-logic.ts`, `money.ts`, `api-client.ts`) | PASSOU* | *único erro: `process` sem `@types/node`, artefato do check isolado (o projeto declara `@types/node`) |
| Execução real da lógica financeira (node) | PASSOU | expected = 10000+5000+4980−3000 = 16980; diferenças +20/−80; parsing "10,50"→1050, rejeição de "10,555"/"-5" |
| `pnpm lint` / `pnpm test` / `pnpm build` | NÃO EXECUTADO | sem dependências/Postgres |
| Checagem estática (imports, alias `@/`, JSON, chaves) | PASSOU | repo inteiro |

## Pendências

- Estrutural (todas as fatias): rodar num ambiente real, nesta ordem:
  `pnpm install && docker compose up -d && pnpm db:generate && pnpm db:migrate
  && pnpm db:constraints && pnpm db:seed && pnpm typecheck && pnpm lint &&
  pnpm test && pnpm build`.
- Checkout online ainda sem seletor de unidade (usa a MATRIZ).
- Sem endpoint de convite/vínculo de usuário a unidades (testes usam Prisma).
- Sangria/suprimento sem deduplicação automática (decisão documentada).

## Próxima fatia

Segundo o roadmap original: **Mesas + Comandas** (Fase 09). Implementada
a seguir.

---

# MVP — Fatia 09: Mesas + Comandas

**Status: CONCLUÍDA E VALIDADA** — typecheck, lint, testes unitários e
e2e todos executados de fato neste ambiente (que tem Postgres/Redis reais via
`docker-compose.yml` e rede liberada), diferente das fatias anteriores. Fluxo
completo também verificado num browser real (Playwright/Chromium headless
contra os dois dev servers rodando de verdade) — não só pela suíte de testes.

## Arquitetura

Mesa (`DiningTable`) e Comanda (`Tab`/`TabItem`) são entidades **próprias**,
não um reaproveitamento de `Order` como "pedido em aberto". `Order` continua
intocado; `OrderCreationService` não foi alterado. O fechamento de uma
comanda (`POST /v1/tabs/:id/close`) é **só operacional** — não gera `Order`
nem lida com pagamento; a resposta inclui `paymentPending: true` para deixar
isso explícito. Essa integração fica para uma fase futura.

## Modelos / migration

- `DiningTable` (`tenantId`, `branchId`, `number` int, `name?`, `active`) —
  `@@unique([branchId, number])`: número de mesa único só **dentro** da
  unidade (duas branches do mesmo tenant podem ter ambas uma "Mesa 1").
- `Tab` (`tenantId`, `branchId`, `tableId`, `status` `OPEN`/`CLOSED`,
  `customerName?`, `openedAt`, `closedAt?`).
- `TabItem` (`tenantId`, `tabId`, `productId`, `productNameSnapshot`,
  `unitPriceCentsSnapshot`, `quantity`, `notes?`) — mesmo padrão de snapshot
  do `OrderItem` (fatia 04): preço/nome do `Product` no momento da adição,
  preservado mesmo que o produto mude depois.
- Migration `20260928012029_add_tables_and_tabs` gerada e aplicada
  (`pnpm db:migrate`) — não duplicada, incremental sobre o schema existente.
- `Tab.table` e `TabItem.product` usam `onDelete: Restrict` (mesmo padrão de
  `OrderItem.product`): uma mesa ou produto que já teve uma comanda nunca
  pode ser removido por FK, só desativado.
  `ProductsService.remove()` ganhou uma segunda checagem (`tabItem.count()`,
  `409 PRODUCT_HAS_TAB_ITEMS`) espelhando a que já existia para `OrderItem`
  — efeito colateral necessário do novo relacionamento, não um refactor.

## Concorrência (obrigatório pelo enunciado)

Uma mesa nunca pode ter duas comandas `OPEN` simultâneas, garantido em DUAS
camadas independentes (mesmo padrão do Caixa na fatia 08):

1. **Aplicação**: `TabsService.open()` roda `SELECT id FROM dining_tables
   WHERE id = $1 FOR UPDATE` dentro de uma transação antes de checar/criar —
   a segunda requisição concorrente bloqueia na trava até a primeira
   commitar, e então vê a comanda já `OPEN` e falha com `409
   TABLE_ALREADY_OCCUPIED`.
2. **Banco**: índice único parcial `tabs_one_open_per_table` em
   `prisma/sql/tabs_constraints.sql` (`ON tabs(tableId) WHERE status =
   'OPEN'`), aplicado via `pnpm db:tabs-constraints` (novo script,
   `prisma db execute`) — backstop caso a trava de linha seja
   contornada por algum caminho futuro; o `P2002` desse índice também é
   capturado e vira o mesmo 409, nunca um 500.

Testado com 3 requisições `POST /v1/tabs` disparadas em paralelo
(`Promise.all`) para a mesma mesa: exatamente 1× `201`, 2× `409`, e
`tab.count({status:'OPEN'})` confirmado em 1 no banco depois. O mesmo padrão
de `SELECT ... FOR UPDATE` + recheck dentro da transação protege cada
mutação de item e o `close()` contra uma comanda sendo fechada ao mesmo
tempo em que um item é adicionado (`409 TAB_CLOSED` / `TAB_ALREADY_CLOSED`).

## Backend — Mesas

`GET /v1/tables?branchId=` (`tables.read`, `branchId` obrigatório — mesmo
padrão do PDV/Caixa, uma tela por unidade) · `GET /v1/tables/:id`
(`tables.read`) · `POST /v1/tables` (`tables.create`, 409
`TABLE_NUMBER_TAKEN` em duplicidade) · `PATCH /v1/tables/:id`
(`tables.update`) · `DELETE /v1/tables/:id` (`tables.delete`, 409
`TABLE_HAS_OPEN_TAB` com comanda aberta, 409 `TABLE_HAS_TAB_HISTORY` mesmo
com comanda já fechada — ver FK acima). `status` (`AVAILABLE`/`OCCUPIED`) e
`openTabId`/`openTabTotalCents`/`openTabItemCount` são **sempre derivados**
de existir ou não uma `Tab` `OPEN` para a mesa — nunca uma coluna própria,
nunca calculado no frontend.

## Backend — Comandas

`GET /v1/tabs?branchId=&status=` (`tabs.read`; abertas por padrão) ·
`GET /v1/tabs/:id` (`tabs.read`; mesa + itens + subtotal/total) ·
`POST /v1/tabs` (`tabs.create`; valida branch + mesa da mesma
tenant/branch/ativa; 409 em mesa ocupada) · `POST /v1/tabs/:id/items`
(`tabs.update`) · `PATCH /v1/tabs/:id/items/:itemId` (`tabs.update`;
quantidade/observação) · `DELETE /v1/tabs/:id/items/:itemId`
(`tabs.update`) · `POST /v1/tabs/:id/close` (`tabs.close`; exige ao menos 1
item — 409 `TAB_EMPTY` senão).

Preço nunca vem do cliente: `AddTabItemDto` só tem
`productId`/`quantity`/`notes` (mesma garantia estrutural do
`OrderCreationService`) — o produto é sempre relido do banco, escopado por
`tenantId` + `active: true` (produto inexistente, de outro tenant, ou
inativo colapsam no mesmo `400 PRODUCT_UNAVAILABLE`, sem vazar qual). Como
esta é uma rota **autenticada** de staff (não o checkout público de
convidado), um campo de preço "contrabandeado" no payload é **rejeitado com
400** pelo `StrictValidationPipe` global — mesmo comportamento do PDV
(fatia 07), não o "ignorar silenciosamente" do checkout público. `Product`
não tem `branchId` neste schema (catálogo é por tenant, não por unidade), então
não há checagem de branch para produto — mesma premissa já usada por
`OrderCreationService`/`PosOrdersService`.

## Permissions

Novas: `tables.read/create/update/delete`, `tabs.read/create/update/close`.
Seed atualizado (`OWNER`/`ADMIN`: tudo; `MANAGER`: tudo; `WAITER`: leitura de
mesas + operação completa de comandas — é a persona principal do salão;
`CASHIER`/`VIEWER`: só leitura, `tables.read`/`tabs.read`; `KITCHEN`/
`DELIVERY`: nada).

## Frontend

- `/dashboard/mesas` — grid de mesas da unidade selecionada (reaproveita
  `useActiveBranch`/`BranchSelector`, mesmo padrão do PDV/Caixa), badge
  Disponível/Ocupada, itens+total da comanda quando ocupada, criação de mesa
  inline (número + nome opcional). Polling de 15s (mesmo padrão de
  `/dashboard/pedidos`).
- `/dashboard/mesas/[tableId]` — mesa disponível mostra formulário "abrir
  comanda"; mesa ocupada mostra catálogo (busca + chips de categoria,
  reaproveitando `categoriesApi`/`productsApi`/`filterPosProducts` do
  PDV — nenhum catálogo/carrinho paralelo) e o painel da comanda atual.
  Cada ação (adicionar/±quantidade/editar observação/remover/fechar) chama
  a API imediatamente — nada de carrinho local somado no fim como no PDV; o
  total exibido é sempre o que a API acabou de devolver.
- `lib/tables-api.ts`, `lib/tabs-api.ts` — wrappers finos sobre `apiFetch`,
  mesmo padrão de `lib/cardapio-api.ts`/`lib/pos-api.ts`.
- Link "Mesas (salão)" no `/dashboard`, visível para
  OWNER/ADMIN/MANAGER/WAITER/CASHIER (mesmo padrão de gate por papel dos
  outros links).

## Testes

- `apps/api/src/modules/tabs/tab-calculations.spec.ts` — unitário, puro:
  soma de `unitPriceCentsSnapshot * quantity`, comanda vazia, total espelha
  subtotal.
- `apps/api/test/tables.e2e-spec.ts` (8 casos) — criar, listar (ordenado por
  número), atualizar, número duplicado na mesma branch (409), mesmo número
  permitido em branch diferente, isolamento de tenant, apagar mesa com
  comanda aberta bloqueado, apagar mesa com histórico de comanda (mesmo
  fechada) bloqueado (409, não um 500 de FK).
- `apps/api/test/tabs.e2e-spec.ts` (13 casos) — abrir comanda, bloquear
  segunda comanda na mesma mesa, adicionar produto com snapshot correto,
  rejeitar preço contrabandeado (400), rejeitar produto inativo, rejeitar
  produto de outro tenant, alterar quantidade recalculando o total, remover
  item, total correto com múltiplos itens/quantidades, fechar exige item
  (409 vazio) e bloqueia qualquer alteração depois (409 nos 4 casos:
  add/update/remove/close de novo), mesa fica `AVAILABLE` de novo e aceita
  nova comanda, isolamento entre tenants, isolamento entre branches,
  concorrência de abertura (3 simultâneas → exatamente 1× 201).
- Nenhum teste de frontend novo: a lógica de filtro de catálogo já é
  testada em `pos-logic.test.ts` (reaproveitada, não duplicada); as telas
  novas são fluxo de UI puro sobre chamadas de API já cobertas pelos e2e
  acima — verificado manualmente num browser real em vez de duplicar
  cobertura com um teste de componente de baixo valor.

## Decisões importantes

- Fechar uma comanda é **só** a transição `OPEN → CLOSED` — nenhum `Order`
  é criado, nenhum pagamento é processado. `paymentPending: true` na
  resposta deixa isso visível para quem for integrar a próxima fase.
- Uma mesa com qualquer histórico de comanda (mesmo já fechada) nunca pode
  ser excluída — só desativada. Essa regra é mais estrita do que o
  enunciado pedia literalmente ("impedir apagar mesa com comanda **aberta**"),
  mas é exigida pela própria FK `onDelete: Restrict` escolhida (mesma que
  `OrderItem.product`, para preservar histórico) — sem ela, apagar uma mesa
  com uma comanda fechada estouraria um erro cru de FK do Postgres (500) em
  vez de um 409 legível.
- `branchId` é obrigatório em `GET /v1/tables`/`GET /v1/tabs` (diferente de
  `GET /v1/orders`, que aceita omitir): salão é sempre uma tela por unidade,
  igual PDV/Caixa, não um relatório cross-branch.

## Validações

| Verificação | Resultado |
|---|---|
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:tabs-constraints` | EXECUTADO — migration `add_tables_and_tabs` aplicada, índice parcial criado |
| `pnpm typecheck` | PASSOU (api + web) |
| `pnpm lint` | PASSOU (api + web, 0 avisos) |
| `pnpm test` (unitários) | PASSOU — api 6/6 suítes (35 testes), web 3/3 suítes (31 testes) |
| `pnpm --filter api test:e2e` | PASSOU — **11/11 suítes, 101/101 testes**, sem regressão nas fatias anteriores |
| Verificação manual em browser real (Playwright/Chromium) | PASSOU — fluxo completo: registrar → criar mesa → abrir comanda → adicionar produto → +/- quantidade → remover → fechar (com confirmação) → mesa `AVAILABLE` de novo → reabrir nova comanda; sem erros de console |

## Pendências

- Integração financeira (gerar `Order`/pagamento ao fechar uma comanda) —
  deliberadamente fora de escopo desta fatia, como pedido.
- Mesmas pendências estruturais já conhecidas de fatias anteriores (sem
  endpoint de convite de usuário — testes de papel usam Prisma direto).

---

# MVP — Fase 10: Fechamento de Comanda + Integração Financeira

**Status: CONCLUÍDA E VALIDADA** — migration aplicada, typecheck/lint/unit/
e2e executados de fato, e fluxo testado em browser real (Playwright/Chromium
contra os dev servers + Postgres).

## O que mudou

`POST /v1/tabs/:id/checkout` transforma uma comanda OPEN em venda paga:
`Order` + `OrderItem`s (dos snapshots) + `Payment` + (CASH) `CashMovement
SALE` + Tab `CLOSED`, numa **única transação**. O antigo `POST
/v1/tabs/:id/close` (fechamento só operacional da fatia 09) foi **removido**:
fechar uma comanda agora sempre significa vendê-la — manter o endpoint
antigo deixaria uma brecha de comanda fechada sem venda. Os testes da fatia 09
que usavam `/close` passaram a usar o checkout.

## Models / migration

Migration `20260928030000_tab_checkout_payments` (incremental; nenhuma
constraint anterior removida):

- `OrderSource` + `TABLE`; `FulfillmentType` + `DINE_IN`. O checkout
  público passou de `@IsEnum(FulfillmentType)` para `@IsIn(['DELIVERY',
  'PICKUP'])` — comportamento público idêntico, `DINE_IN` nunca vem de
  convidado (testado: 400).
- `Order.tabId String? @unique` (+ FK `Restrict` para `Tab`) e
  `Order.idempotencyKey String?` com `@@unique([tenantId, idempotencyKey])`.
  Postgres aceita vários NULL em UNIQUE, então pedidos ONLINE/COUNTER não
  são afetados.
- Novo `Payment` (`orderId @unique`, `method`, `status`
  PENDING/CONFIRMED/FAILED, `provider` INTERNAL, `amountCents`,
  `externalId?`, `confirmedAt?`). Nesta fatia só é criado pelo checkout de
  comanda (INTERNAL/CONFIRMED); checkout público e PDV não foram alterados
  e continuam sem linha em `payments`.
- Obs.: `prisma migrate dev` recusa rodar não-interativo quando há aviso de
  novo UNIQUE; a migration foi gerada com `prisma migrate diff` (diff limpo,
  sem tocar nos índices parciais de `db:constraints`/`db:tabs-constraints`) e
  aplicada com `migrate deploy`. `pnpm db:migrate` depois confirma "Already
  in sync".

## Constraints que garantem "nunca duplicar financeiro"

| Invariante | Garantia no banco |
|---|---|
| 1 Tab → no máximo 1 Order | `orders_tabId_key` (UNIQUE) |
| 1 idempotencyKey → 1 venda (por tenant) | `orders_tenantId_idempotencyKey_key` |
| 1 Order → 1 pagamento | `payments_orderId_key` |
| 1 Order → 1 SALE no caixa | `cash_movements_orderId_key` (já existia, fatia 08) |
| 1 mesa → 1 Tab OPEN | `tabs_one_open_per_table` (parcial, fatia 09) |

## Fluxo transacional (`TabsService.checkout`)

1. Fora da transação: valida tenant (404) e branch (`BranchAccessService`,
   403); se a `idempotencyKey` já gerou venda, resolve direto (ver abaixo).
2. Auditoria `TAB_CHECKOUT_STARTED`.
3. Transação: `SELECT ... FROM tabs WHERE id = $1 FOR UPDATE` → se não está
   OPEN, relê o `Order` da tab **depois do lock** → exige ≥ 1 item
   (`409 TAB_EMPTY`) → `OrderCreationService.createPricedOrderInTx()` (trava
   a sessão de caixa se CASH, cria Order + OrderItems + SALE) →
   `PaymentsService.recordInternalConfirmed()` → Tab `CLOSED`.
4. Depois do commit: auditorias `ORDER_CREATED`, `CASH_MOVEMENT_CREATED`
   (se CASH) e `TAB_CHECKOUT_COMPLETED` (tenant, user, branch, tab, order,
   total, método, paymentId, cashMovementId). Falha → `TAB_CHECKOUT_FAILED`
   com o código do erro.

**Sem segunda implementação de Order**: `OrderCreationService` foi dividido em
`createOrder()` (checkout público/PDV — relê preço do `Product`, comportamento
inalterado) e o núcleo `createPricedOrderInTx(tx, ...)`, que recebe itens já
precificados e a transação do chamador. A comanda usa o núcleo com os preços
dos `TabItem` (`buildPricedItemsFromTab`), nunca do `Product` atual.

Estado final: `Order.status = COMPLETED` (a comida já foi servida e a conta
está paga — a venda nasce concluída e não entra no fluxo da cozinha/KDS),
`source = TABLE`, `fulfillmentType = DINE_IN`, `Payment.status = CONFIRMED`,
Tab `CLOSED` (somente leitura), mesa volta a `AVAILABLE`.

## Idempotência

A resposta traz `idempotentReplay`. Qualquer requisição que encontre uma
venda existente (pela chave antes da transação, pela tab depois do lock, ou
após um `P2002`) é classificada por `classifyExistingCheckout` (pura, testada):

- mesma tab + mesma chave → **replay**: devolve a venda existente (200), nada
  é escrito;
- mesma tab + outra chave → `409 TAB_ALREADY_CLOSED`;
- chave já usada em outra tab → `409 IDEMPOTENCY_KEY_REUSED`.

Uma tentativa que falhou (ex.: `CASH_REGISTER_NOT_OPEN`, rollback) não
consome a chave — a mesma chave funciona depois (testado).

## Concorrência

O lock da linha da Tab serializa checkouts da mesma comanda; o perdedor
espera, relê a tab como CLOSED e cai na classificação acima. O `P2002`
(ex.: mesma chave em duas tabs diferentes ao mesmo tempo) é capturado e
resolvido contra o vencedor — nunca 500. Ordem de lock sempre **Tab →
sessão de caixa**; fechamento de caixa e venda do PDV só travam a sessão,
então não há ciclo/deadlock. Testado: 3 checkouts simultâneos com a mesma
chave → 3×200, mesmo `orderId`, exatamente 1 Order/1 Payment/1 SALE; 2
simultâneos com chaves diferentes → `[200, 409]`, idem 1/1/1.

## Integração com Caixa

Nenhuma lógica de caixa nova: reaproveita `CashRegisterService.
lockOpenSessionForSale` + `recordSale` (fatia 08) dentro da mesma transação.
CASH sem sessão OPEN → `409 CASH_REGISTER_NOT_OPEN` e nada persiste. O
`GET /v1/tabs/:id` expõe só `branchCashRegisterOpen: boolean` para a tela
avisar antes (sem dar `cash.read` ao WAITER); a trava real continua dentro da
transação. PIX/CARD: pagamento INTERNAL confirmado, sem chamada externa, sem
movimento de caixa. Gateway futuro: criar `Payment` PENDING + `externalId`
e confirmar por webhook — o modelo já comporta.

## Endpoints

- `POST /v1/tabs/:id/checkout` (`tabs.close`) — body `{ paymentMethod,
  idempotencyKey }` (qualquer campo extra, ex. valor, → 400). 200 com a tab
  fechada + venda + `idempotentReplay`.
- `GET /v1/tabs/:id` — agora inclui `order: { id, orderNumber, status,
  paymentMethod, totalCents, payment: { status, method, amountCents,
  confirmedAt } } | null` e `branchCashRegisterOpen`.
- Removido: `POST /v1/tabs/:id/close`.
- Sem permission nova: o checkout usa `tabs.close` (WAITER/MANAGER/OWNER/ADMIN).

## Frontend

`/dashboard/mesas/[tableId]`: "Fechar conta" abre painel com Itens/Subtotal/
Total (valores da API) e Dinheiro/PIX/Cartão. Dinheiro com caixa fechado fica
bloqueado com aviso; se a API ainda assim responder `CASH_REGISTER_NOT_OPEN`,
a mensagem aparece e a tela é atualizada. Uma `idempotencyKey`
(`crypto.randomUUID()`) por tentativa, reenviada em retries; guarda síncrona
(`useRef`) + botão desabilitado contra duplo clique. Sucesso mostra número do
pedido, valor e "Pagamento confirmado"; a mesa volta a Disponível. Admin
(`/dashboard/pedidos`, detalhe, KDS) ganhou rótulos "Mesa" para `TABLE`/
`DINE_IN` via mapas compartilhados em `lib/orders-api.ts`.

Achado durante o teste em browser: `<Button className="bg-...">` não
sobrescreve o `bg-zinc-900 text-white` base do componente (ordem do CSS
gerado pelo Tailwind), deixando "Cancelar" ilegível. No painel novo foram
usados `<button>` com classes explícitas. **Os outros usos de `<Button
className="w-auto bg-...">` no app têm o mesmo problema** (pré-existente, não
corrigido aqui para não refatorar telas fora do escopo).

## Testes

- Unit (api): `tab-checkout.spec.ts` — snapshot→item de venda, total da venda
  = total da comanda, classificação replay/já-fechada/chave-reusada.
- Unit (web): `lib/tab-checkout-logic.test.ts` — bloqueios do botão
  (sem itens, sem forma de pagamento, CASH com caixa fechado).
- E2E `test/tab-checkout.e2e-spec.ts` (17 casos, cobre os 20 itens): CASH
  (Order/itens/total/SALE/Tab CLOSED/mesa AVAILABLE/visível no admin),
  snapshot após mudança de preço, CASH sem caixa (nada persiste), PIX, CARD,
  segundo checkout 409, chave repetida = replay, chave reusada em outra tab,
  concorrência mesma chave e chaves diferentes, isolamento de tenant e de
  branch, comanda vazia, valor/método inválido 400, **rollback completo**
  (trigger temporário faz o INSERT de `payments` falhar depois de Order +
  itens + SALE já escritos na transação → nada fica; a mesma chave funciona
  depois), `GET` com resumo + auditoria, checkout público rejeita `DINE_IN`.

## Validações

| Verificação | Resultado |
|---|---|
| `pnpm db:generate` / `db:migrate` / `db:constraints` / `db:tabs-constraints` | OK — "Already in sync" |
| `pnpm typecheck` | PASSOU (api + web) |
| `pnpm lint` | PASSOU (0 avisos) |
| `pnpm test` | PASSOU — api 7 suítes / 40 testes; web 4 suítes / 36 testes |
| `pnpm --filter api test:e2e` | PASSOU — **12/12 suítes, 118/118 testes** (101 anteriores + 17 novos) |
| Browser real | PASSOU — PIX com caixa fechado (Dinheiro bloqueado), duplo clique = 1 venda, preço do produto alterado antes do fechamento não mudou a conta (R$ 59,80), CASH com caixa aberto → 1 SALE de R$ 34,90, pedidos "Mesa/Concluído" no admin, sem erros de console |

## Pendências

- Gateway (Mercado Pago), NFC-e, estoque, WhatsApp — fora de escopo, como pedido.
- Itens de comanda não passam pela cozinha/KDS (a venda nasce COMPLETED);
  envio de itens da mesa para a cozinha é uma fatia própria.
- `OrderItem` não tem `notes`: a observação do `TabItem` (instrução de
  preparo) não é copiada para a venda.
- Botões `<Button className="bg-...">` pré-existentes com cor não aplicada
  (ver Frontend).

---

# COMO RODAR O PROJETO

## 1. Requisitos

- Node.js 20+ (`.nvmrc` na raiz)
- pnpm 9+ (`corepack enable` ativa a versão fixada em `packageManager`)
- Docker + Docker Compose (Postgres + Redis locais) — ou instâncias próprias
  de PostgreSQL 16+ e Redis 7+

## 2. Variáveis de ambiente

Copiar os três `.env.example` e preencher:

```bash
cp .env.example .env                       # usado pelo docker-compose
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

`apps/api/.env` — todas as variáveis abaixo são validadas no boot
(`src/config/env.validation.ts`); faltar uma delas impede o processo de
subir, de propósito:

```
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://saas:saas@localhost:5432/restaurant_saas?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=<mín. 32 caracteres — gerar um valor real, não usar o placeholder>
JWT_REFRESH_SECRET=<mín. 32 caracteres — gerar um valor real, diferente do access>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
```

`apps/web/.env`: `NEXT_PUBLIC_API_URL=http://localhost:4000/v1`

`.env` (raiz, só para o `docker-compose.yml`): `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `REDIS_PORT` — valores
de exemplo já em `.env.example`, sem segredo real.

## 3. Instalação

```bash
pnpm install
```

## 4. PostgreSQL e Redis

```bash
docker compose up -d
```

Sobe os dois com healthcheck. Sem Docker, apontar `DATABASE_URL`/`REDIS_URL`
para instâncias próprias equivalentes.

## 5. Prisma — gerar o client

```bash
pnpm db:generate
```

## 6. Migrations

```bash
pnpm db:migrate
```

Gera e aplica a migration inicial (schema completo: fundação + cardápio +
pedidos + caixa, já que nenhuma migration foi gerada em nenhuma fatia
anterior neste ambiente sem Postgres).

## 7. Constraints do Caixa (obrigatório, roda DEPOIS da migration)

```bash
pnpm db:constraints
pnpm db:tabs-constraints   # fatia 09: 1 comanda OPEN por mesa
```

Aplica `prisma/sql/cash_register_constraints.sql`: o índice único parcial
que impede duas sessões `OPEN` na mesma unidade e o trigger que bloqueia
`UPDATE`/`DELETE` direto em `cash_movements`. Idempotente — pode rodar de
novo sem efeito colateral.

## 8. Seed

```bash
pnpm db:seed
```

Popula roles e permissions (nenhum dado fictício de negócio). Tenants,
usuários e produtos reais entram via `/auth/register` e o painel
administrativo.

## 9. Desenvolvimento

```bash
pnpm dev        # api (porta 4000) + web (porta 3000) juntos
pnpm dev:api    # só a API
pnpm dev:web    # só o frontend
```

API: `http://localhost:4000/v1` · Swagger: `http://localhost:4000/docs`
(fora de produção) · Frontend: `http://localhost:3000`.

## 10. Testes

```bash
pnpm --filter api test        # unitários (guards, cálculo de caixa, transições — sem banco)
pnpm --filter api test:e2e    # e2e — precisa de DATABASE_URL/REDIS_URL reais (passos 4–8 feitos antes)
pnpm --filter web test        # unitários de frontend (carrinho, PDV, caixa — sem banco)
```

## 11. Lint e typecheck

```bash
pnpm lint
pnpm typecheck
```

## 12. Build

```bash
pnpm build
```

---

# Fase 08.1 — Validação Real e Hardening do MVP

Rodada de validação, não de funcionalidade nova. Nenhum módulo alterado
funcionalmente — só 3 correções objetivas de qualidade e a documentação de
como rodar o projeto de verdade.

## Ambiente utilizado

Reconfirmado nesta rodada, de forma exaustiva: `node --version` → v22.22.2,
`npm --version` → 10.9.7. `pnpm`, `docker`, `psql`, `postgres`, `pg_ctl`,
`redis-server` → ausentes. Rede: `curl` para `registry.npmjs.org`,
`github.com` e `archive.ubuntu.com` (via `apt-get update`) → todos HTTP 403
(egress bloqueado por allowlist do sandbox, não uma falha transitória).
`npx pnpm@9` também falhou por HTTP 403. Sem cache local de `node_modules`
nem de `~/.npm/_cacache`. Conclusão: **impossível instalar qualquer
dependência ou subir Postgres/Redis neste ambiente**, exatamente como em
todas as sete fatias e na rodada de caixa anteriores — não é uma regressão
desta rodada, é uma característica constante do ambiente.

## O que passou (executado de verdade, não suposto)

- **Checagem estática do repositório inteiro**: todo import relativo e
  alias `@/` resolvido programaticamente contra o sistema de arquivos, todo
  `.json` parseado, chaves/parênteses de todos os arquivos balanceados —
  PASSOU.
- **Varredura de imports não utilizados** (heurística própria: cada nome
  importado precisa reaparecer no corpo do arquivo) em **todo** o
  repositório — encontrou 3 reais, corrigidos (ver abaixo).
- **Busca por `any` explícito** em todo o repositório — só ocorrências
  legítimas e já documentadas (`let server: any` nos 9 specs e2e, cada uma
  com `eslint-disable-next-line` acima, confirmado nos 9 arquivos).
- **Consistência de scripts**: todo `db:*`/`prisma:*` da raiz e de
  `apps/api/package.json` aponta para um script existente — sem alias
  quebrado.
- **`.env.example` vs. validação real**: as 9 variáveis que
  `env.validation.ts` exige estão todas presentes em
  `apps/api/.env.example`, nem uma a mais nem a menos.
- **`tsc --strict` real** (com `--ignoreDeprecations 6.0`, sem `node_modules`,
  usando o `tsc` global disponível) nos 4 módulos de lógica pura sem
  dependência de framework: `cash-calculations.ts`, `money.util.ts`,
  `order-number.util.ts`, `order-status.util.ts` — **PASSOU** de verdade
  (zero erro).
- **Execução real em Node** (não simulada) da lógica financeira compilada:
  `computeCashTotals`/`computeExpectedBalanceCents`/`computeDifferenceCents`
  com os mesmos números do exemplo do fechamento (10000 + 5000 + 4980 −
  3000 = 16980; diferenças +20/−80) e `parseBRLToCents`/`formatCents`
  (aceita "10,50"/"R$ 0,10", rejeita "10,555"/"-5", formata negativo como
  "-R$ 0,90") — **PASSOU**, resultados exatamente como esperado.
- **Conferência manual, campo a campo**, de todo o código novo da fatia 08
  contra o `schema.prisma` real: nomes de acessor do Prisma Client
  (`cashRegisterSession`, `cashMovement`, `order`, `product` — todos batem
  com a convenção camelCase do nome do modelo), nomes de tabela usados nas
  4 queries `$queryRaw` batem exatamente com os `@@map(...)` do schema,
  chave composta `userId_branchId` usada em `BranchAccessService` bate com
  `@@unique([userId, branchId])` em `UserBranch`, `CashMovement.orderId`
  confirmado `@unique`, e confirmado por grep que não existe nenhuma rota
  `PATCH`/`DELETE` de movimento nem de reabertura de sessão (imutabilidade
  garantida pela ausência do caminho, não só por uma checagem) — **PASSOU**.

## O que foi tentado e não deu sinal confiável (registrado com honestidade)

Tentei ampliar a compilação `tsc --strict` para todo o grafo de módulos
tocado na fatia 08 (cash, order-creation, pos, branches, public-orders,
orders + dependências locais), escrevendo declarações `.d.ts` avulsas para
`@nestjs/common`, `@prisma/client` etc. na mão. Resultado: ~80 erros, dos
quais **nenhum** é um bug real — todos rastreáveis a lacunas dos meus stubs
simplificados (ex.: `OrderStatus` declarado como `type` em vez do objeto
JS real que o Prisma gera, fazendo `@IsEnum(OrderStatus)` falhar por "usado
como valor"; `$transaction` sem overload tipado, gerando parâmetro `tx`
implicitamente `any`; `zod`/`rxjs` não mapeados). Reescrever esses stubs até
zerar o ruído equivaleria a reimplementar `@nestjs/common` e o client
gerado do Prisma à mão — desproporcional e poderia mascarar sinal real com
sinal fabricado. Optei por não seguir por esse caminho e não contar esse
resultado como "TypeScript: PASSOU" — só os 4 arquivos puros acima têm esse
selo, ganho honestamente.

## Bugs corrigidos nesta rodada (P2 — qualidade, nenhum funcional)

1. `apps/api/src/modules/cash/dto/create-movement.dto.ts` — import
   `IsOptional` nunca usado (o campo `reason` usa só `@ValidateIf`).
2. `apps/api/src/modules/order-creation/order-creation.service.ts` — import
   `NotFoundException` nunca usado (a resolução de tenant/branch é feita
   pelos chamadores, não por este serviço).
3. `apps/web/app/dashboard/caixa/page.tsx` — import `ApiError` nunca usado
   (o tratamento de erro do formulário usa `Error` puro).

Nenhum bug funcional, de segurança, cross-tenant ou financeiro foi
encontrado nesta rodada.

## O que ainda está pendente

- **Tudo que depende de rede/Postgres**: `pnpm install`, `prisma generate`,
  `prisma migrate`, `pnpm db:constraints`, `pnpm db:seed`, `pnpm lint`
  completo, testes unitários e e2e via Jest, `pnpm build` (frontend e
  backend). Comandos exatos e ordem: seção "COMO RODAR O PROJETO" acima.
- Mesmas pendências de fatias anteriores: checkout online sem seletor de
  unidade (usa a MATRIZ), sem endpoint de convite/vínculo de usuário a
  unidades, sangria/suprimento sem deduplicação automática.

## Validação final

| Verificação | Resultado | Observação |
|---|---|---|
| pnpm install | NÃO EXECUTADO | sem rede (registry.npmjs.org → HTTP 403); `npx pnpm` também 403 |
| Prisma generate | NÃO EXECUTADO | depende de `pnpm install` |
| Prisma migrate | NÃO EXECUTADO | sem PostgreSQL neste ambiente |
| db constraints | NÃO EXECUTADO | depende da migration existir |
| seed | NÃO EXECUTADO | depende de client Prisma gerado + banco migrado |
| TypeScript (projeto completo) | NÃO EXECUTADO | sem `node_modules`/pacotes reais |
| TypeScript (4 módulos de lógica pura, isolados) | PASSOU | `tsc --strict` real, zero erro |
| ESLint | NÃO EXECUTADO | `eslint` não instalado |
| Unit tests (Jest, via `pnpm test`) | NÃO EXECUTADO | `jest` não instalado |
| Lógica financeira/monetária (execução manual em Node) | PASSOU | mesmos arquivos compilados, executados com asserts reais |
| E2E tests | NÃO EXECUTADO | requer PostgreSQL/Redis reais, indisponíveis |
| Backend build | NÃO EXECUTADO | `@nestjs/cli` não instalado |
| Frontend build | NÃO EXECUTADO | `next` não instalado |
| Checagem estática (imports, JSON, chaves, `any`, scripts, `.env.example`) | PASSOU | repositório inteiro, ver detalhe acima |

## Próximo passo recomendado

Rodar a sequência da seção "COMO RODAR O PROJETO" (1→12) num ambiente real
com rede e Docker. Só depois disso — com `db:migrate`+`db:constraints`
aplicados e a suíte e2e (`cash.e2e-spec.ts`, `pos.e2e-spec.ts` e as demais)
realmente verde — o status deste arquivo deve subir para `MVP VALIDADO` ou
`MVP VALIDADO COM PENDÊNCIAS`. Não implementar Mesas/Comandas antes disso.

---

# Reconciliação do estado do Caixa

**Cenário encontrado: A — o Caixa está implementado.** Verificado fisicamente
(não pelo relatório anterior):

| Artefato | Presente | Onde |
|---|---|---|
| `enum CashSessionStatus`, `enum CashMovementType` | sim | `apps/api/prisma/schema.prisma` |
| `model CashRegisterSession`, `model CashMovement` | sim | idem |
| `Order.branchId` (obrigatório, FK `Branch`, índice) | sim | idem |
| `CashMovement.orderId @unique` (idempotência SALE) | sim | idem |
| Índice único parcial + trigger de imutabilidade | sim | `apps/api/prisma/sql/cash_register_constraints.sql` (`pnpm db:constraints`) |
| Módulo `cash` (service, controller, DTOs, cálculos puros + spec) | sim | `apps/api/src/modules/cash/` |
| `BranchAccessService` + `GET /v1/branches/accessible` | sim | `apps/api/src/modules/branches/` |
| Integração PDV (`recordCashSaleByUserId` → `lockOpenSessionForSale` + `recordSale` na mesma transação) | sim | `pos-orders.service.ts`, `order-creation.service.ts` |
| Permissões `cash.*` no seed | sim | `apps/api/prisma/seed.ts` |
| Frontend `/dashboard/caixa` + seletor de unidade no PDV | sim | `apps/web/app/dashboard/caixa/page.tsx`, `lib/use-active-branch.ts` |
| Testes (`cash.e2e-spec.ts` 17 casos, `pos.e2e-spec.ts`, specs unitários) | sim | `apps/api/test/`, `apps/api/src/modules/cash/`, `apps/web/lib/cash-api.test.ts` |
| **Migrations Prisma** | **NÃO** | nunca geradas em nenhuma fatia |

**Sobre as migrations (lacuna real, não do Caixa especificamente):**
`prisma/migrations/` não existe porque gerá-la exige a CLI do Prisma e seu
schema engine — nenhum dos dois está instalado, e ambos os hosts de download
(`registry.npmjs.org`, `binaries.prisma.sh`) retornam HTTP 403 neste
ambiente. Escrever o SQL da migration à mão para "parecer gerado" foi
deliberadamente recusado (poderia divergir do que o Prisma realmente
produziria). O primeiro `pnpm db:migrate` num ambiente com rede gera a
migration inicial com **todo** o schema atual, Caixa incluído, seguido de
`pnpm db:constraints`.

**Verificação do ZIP:** `MANIFEST.sha256` na raiz lista o SHA-256 de todos os
arquivos do repositório no momento do empacotamento. Conferir com
`sha256sum -c MANIFEST.sha256` na pasta extraída.

---

# Validação Real — 2026-09-28

**Status desta rodada: MVP VALIDADO COM PENDÊNCIAS.**

Ambiente: Windows 11, Docker Desktop (Postgres 16-alpine + Redis 7-alpine via
`docker-compose.yml`), Node 24, pnpm 9.12.0. Esta foi a primeira execução
real de toda a cadeia de instalação/migração/teste/build deste projeto — as
rodadas anteriores (Fase 01 até Fatia 08) foram só revisão manual de código,
sem compilador/rede/banco disponíveis. Nenhuma funcionalidade nova foi
implementada nesta rodada, por instrução explícita (sem Mercado Pago, NFC-e,
Estoque, Delivery, CRM, e sem tocar em Mesas/Comandas alem do que já existia).

## Resultado por etapa

| # | Etapa | Resultado |
|---|---|---|
| 1 | `pnpm install` | ✅ PASSOU (lockfile já resolvido, `node_modules` já presente) |
| 2 | `docker compose up -d` | ✅ PASSOU (Postgres e Redis `healthy`) |
| 3 | `pnpm db:generate` | ✅ PASSOU (Prisma Client 5.22.0 gerado) |
| 4 | `pnpm db:migrate` | ✅ PASSOU (3 migrations já existiam e estavam em sync com o banco: `initial_mvp_schema`, `add_tables_and_tabs`, `tab_checkout_payments`) |
| 5 | `pnpm db:constraints` | ✅ PASSOU (índice único parcial `cash_register_sessions_one_open_per_branch` + trigger de imutabilidade de `cash_movements` confirmados via `\d` no psql) |
| 6 | `pnpm db:seed` | ✅ PASSOU (roles, permissions e role↔permission; nenhum dado fictício de negócio) |
| 7 | `pnpm typecheck` | ✅ PASSOU (`api` e `web`, `tsc --noEmit`, zero erros) |
| 8 | `pnpm lint` | ✅ PASSOU (`api` via ESLint, `web` via `next lint`, zero avisos) |
| 9 | `pnpm test` (unit) | ✅ PASSOU — api: 7 suites/40 testes; web: 4 suites/36 testes |
| 10 | `pnpm --filter api test:e2e` | ✅ PASSOU (após correção, ver abaixo) — **12 suites / 118 testes**, contra Postgres+Redis reais |
| 11 | `pnpm --filter web test` | ✅ PASSOU — 4 suites/36 testes (mesmo conjunto do item 9, roda isolado) |
| 12 | `pnpm build` | ✅ PASSOU (após correção, ver abaixo) — `api` (`nest build`) e `web` (`next build`, 13 rotas, build de produção completo) |

**Tabelas confirmadas no Postgres** (via `\dt` no container): `tenants`,
`branches`, `users`, `categories`, `products`, `orders`, `order_items`,
`cash_register_sessions`, `cash_movements` — todas as 9 pedidas — mais
`roles`, `permissions`, `role_permissions`, `user_roles`, `user_branches`,
`refresh_tokens`, `audit_logs`, `dining_tables`, `tabs`, `tab_items`,
`payments` (fatias posteriores já presentes no schema, não implementadas
nesta rodada).

## Problemas encontrados e corrigidos

### 1. Falso negativo no e2e por contenção de recursos (não é bug de negócio)

**Sintoma:** na primeira execução de `pnpm --filter api test:e2e`, **11 das
12 suites falharam** com `PrismaClientKnownRequestError: Transaction API
error: Transaction already closed` (timeout de transação interativa de
5000ms excedido em 6–10s) em operações triviais como `auth.register`
(5 escritas simples numa transação).

**Causa raiz:** o Jest, sem configuração de `maxWorkers`, tentou rodar as 12
suites e2e em paralelo (até 11 workers nesta máquina de 12 núcleos) — cada
worker sobe uma instância completa da aplicação Nest (incluindo hash Argon2,
que é deliberadamente pesado em CPU) contra o **mesmo** container Postgres.
A contenção de CPU/conexões fez consultas triviais ficarem na fila tempo
suficiente para expirar o timeout da transação interativa do Prisma — um
problema de infraestrutura de teste, não de lógica da aplicação.

**Correção aplicada:** `apps/api/test/jest-e2e.json` — adicionado
`"maxWorkers": 1`, forçando as suites e2e (que compartilham um único banco)
a rodar em série. É a prática padrão para suítes e2e apoiadas em um banco
compartilhado. Depois da correção: **12/12 suites, 118/118 testes,
30.7s.** Nenhuma linha de código de negócio foi alterada.

### 2. Bug real: `nest build` escrevia a saída no diretório errado

**Sintoma:** `pnpm build` reportava sucesso para `api`, mas
`apps/api/dist/` nunca era criado — o build "passava" sem produzir nenhum
artefato utilizável (o backend não teria como ser iniciado em produção com
`node dist/src/main.js`).

**Causa raiz:** `packages/tsconfig/nestjs.json` (config TS compartilhada,
usada via `extends` por `apps/api/tsconfig.json`) define
`"outDir": "./dist"`. Caminhos relativos definidos numa config-base do
TypeScript são resolvidos relativos **à pasta onde a config-base está
localizada**, não à pasta de quem faz `extends` — então o build inteiro do
`api` estava sendo escrito em `packages/tsconfig/dist/` (confirmado: os
arquivos compilados de `src/` e `prisma/seed.ts` do `api` apareceram lá).
`apps/api/tsconfig.json` já sobrescrevia `baseUrl` pelo mesmo motivo
implícito, mas não `outDir`.

**Correção aplicada:** adicionado `"outDir": "./dist"` explicitamente em
`apps/api/tsconfig.json` (mesmo padrão já usado para `baseUrl` no mesmo
arquivo). Removido o `packages/tsconfig/dist/` gerado incorretamente.
Rebuild confirmado: `apps/api/dist/src/main.js` existe; nenhum artefato
voltou a aparecer em `packages/tsconfig/dist/`. Nenhuma lógica de negócio
foi alterada — é puramente configuração de build.

## Os 16 cenários pedidos

Todos os 16 foram exercitados por testes e2e reais (aplicação Nest completa
+ Prisma real + Postgres/Redis reais em Docker, via `supertest` — não é
mock). Mapeamento explícito, todos passando:

| # | Cenário | Onde é testado (arquivo → caso) |
|---|---|---|
| 1 | Cadastro | `auth.e2e-spec.ts` → registra tenant+owner; rejeita slug/document duplicado |
| 2 | Login | `auth.e2e-spec.ts` → login correto/senha errada, `/auth/me`, refresh, logout |
| 3 | Cardápio | `menu.e2e-spec.ts` (CRUD admin) + `public-menu.e2e-spec.ts` (visão pública) |
| 4 | Pedido online | `public-orders.e2e-spec.ts` (13 casos, incl. adulteração de preço bloqueada) |
| 5 | PDV | `pos.e2e-spec.ts` (9 casos, incl. RBAC e adulteração de preço) |
| 6 | Abertura de caixa | `cash.e2e-spec.ts` → abre com saldo inicial; bloqueia 2ª sessão aberta; rejeita saldo negativo |
| 7 | Venda CASH | `cash.e2e-spec.ts` → "CASH sale generates exactly one SALE movement" |
| 8 | SALE no caixa | mesmo caso acima + "SALE is idempotent per order" |
| 9 | PIX sem SALE | mesmo caso do #7 ("...PIX and CARD generate none") |
| 10 | Sangria | `cash.e2e-spec.ts` → "records supply and withdrawal; withdrawal requires a reason" |
| 11 | Suprimento | mesmo caso acima |
| 12 | Fechamento | `cash.e2e-spec.ts` → "closes with backend-computed expected balance and difference"; rejeita valores enviados pelo cliente |
| 13 | Diferença de caixa | mesmo caso acima (diferença sempre calculada no backend) |
| 14 | Concorrência | `cash.e2e-spec.ts` → "concurrent opens...: exactly one wins"; "concurrent closes...: exactly one closes" |
| 15 | Isolamento de tenant | `tenant-isolation.e2e-spec.ts` (4 casos) + `cash.e2e-spec.ts` ("tenant A cannot read/close/move/open using tenant B's...") |
| 16 | Isolamento de branch | `cash.e2e-spec.ts` ("CASHIER linked to branch 1 cannot operate...branch 2") + `pos.e2e-spec.ts` ("rejects...unlinked branch of the same tenant (403)") |

**Não realizado nesta rodada:** um passeio manual clicando/curlando contra um
servidor `pnpm start:dev` de fato em execução. Três tentativas de subir o
servidor em background (Bash `&`, Bash `run_in_background`, PowerShell
`Start-Process`) neste ambiente Windows não deixaram o processo Node
observável (sem escuta na porta 4000, sem log). Isso é uma limitação da
orquestração de processos em background nesta sessão/ambiente, não um
problema do código. Como a suíte e2e já sobe a aplicação real (Nest +
Prisma + Postgres/Redis reais) e faz requisições HTTP reais via
`supertest` — mesma stack, mesma configuração —, os 16 cenários estão
validados de forma real, só não por clique manual em navegador.

## Pendências restantes

- `pnpm db:tabs-constraints` (constraint da tabela `tabs`, feature de
  Mesas/Comandas de uma fatia posterior) **não foi aplicado** — fora do
  escopo desta rodada de validação (que cobre só até o Caixa) e não é
  necessário para nenhum dos 16 cenários pedidos. Aplicar antes de validar
  Mesas/Comandas formalmente.
- `apps/api/.env` usa segredos de exemplo (`JWT_ACCESS_SECRET=change-me-...`)
  — adequado para dev/teste local, **não usar em produção**.
- Não é um repositório git (`git init` nunca rodado) — sem histórico de
  commits para esta base de código.
- Passeio manual end-to-end via servidor `dev` real não realizado (ver nota
  acima); a validação se apoia na suíte e2e automatizada real.

## Por que "VALIDADO COM PENDÊNCIAS" e não "VALIDADO"

Todas as 12 etapas pedidas passaram de verdade (com 2 problemas reais
encontrados e corrigidos, não escondidos) e os 16 cenários de negócio estão
cobertos por testes e2e reais, todos verdes. A ressalva é só pelas 4
pendências acima — nenhuma delas é um bug de lógica de negócio conhecido, e
nenhuma bloqueia o uso do MVP (cadastro→login→cardápio→pedido→PDV→caixa) em
ambiente de desenvolvimento/homologação.

---

# Modo Demonstração (`/demo`) — 2026-09-28

Adicionada uma rota de apresentação isolada, `/demo`, para demonstrar a
plataforma sem depender de Postgres/Redis/dados reais (ex.: em cliente ou
apresentação sem acesso ao ambiente real). **Não altera nenhuma regra de
negócio, API, migration ou schema Prisma** — é puramente frontend, com dados
fictícios centralizados em `apps/web/lib/demo/`. Nenhuma funcionalidade nova
de negócio foi implementada; nenhum módulo real (auth, PDV, KDS, pedidos,
caixa) foi tocado.

**Telas:** `/demo` (dashboard com indicadores), `/demo/cardapio`,
`/demo/pedidos`, `/demo/cozinha`, `/demo/pdv` (interativo, carrinho local,
não cria pedido real), `/demo/caixa`. Selo "Modo demonstração" visível em
toda a rota; rodapé fixo lembrando que os dados são fictícios. Detalhe
completo, inclusive como remover depois, em `docs/DEMO_MODE.md`.

## Validações

| Verificação | Resultado |
|---|---|
| TypeScript (`pnpm --filter web typecheck`) | ✅ PASSOU |
| ESLint (`pnpm --filter web lint`) | ✅ PASSOU — zero avisos |
| Build de produção (`pnpm --filter web build`) | ✅ PASSOU — as 6 rotas `/demo/*` geradas como páginas estáticas (`○`) |

Não foi feito um passeio manual num servidor `dev` ao vivo nesta rodada
(mesma limitação de orquestração de processo em background já registrada na
seção "Validação Real — 2026-09-28" acima) — a validação se apoia em
`typecheck`+`lint`+`build` reais, que já exercitam o SSR de cada página
(`next build` renderiza cada rota estática durante a geração, então um erro
de render teria aparecido aqui).

## Pendências

- Nenhuma pendência de regra de negócio (não se aplica — módulo sem regra de
  negócio real, só dados estáticos).
- Não foi confirmado visualmente num navegador aberto; apenas via build/SSG.

---

# Redesign visual do frontend — 2026-09-28

Refatoração **somente de frontend/UI** (`apps/web`): novo App Shell (sidebar colapsável + topbar com chips), tema escuro e design system em `components/ds/` e `components/shell/`. Detalhes em `docs/UI_DESIGN_SYSTEM.md`. Backend, Prisma, APIs, Auth, RBAC e multi-tenancy **não foram alterados**; a lógica de negócio das páginas (PDV, caixa, comanda, pedidos, KDS, cardápio) foi preservada — mudou apresentação e estrutura.

**Telas redesenhadas:** `/dashboard` (métricas reais derivadas de `GET /orders`, pedidos recentes, fluxo, atividade, atalhos), `/dashboard/pedidos` (+ `[id]`), `/dashboard/cardapio` (seções por categoria, tabela densa, dialogs), `/dashboard/pdv`, `/dashboard/cozinha`, `/dashboard/caixa`, `/dashboard/mesas` (+ `[tableId]`), e `/demo/*` (mesmo shell, dados fictícios, sem API).

**Mudanças de comportamento a notar:** o seletor de unidade agora é global na topbar (`ActiveBranchProvider`); a checagem de login passou para `app/dashboard/layout.tsx`; confirmações de exclusão do cardápio usam dialog em vez de `window.confirm`; "Duplicar produto" usa o `productsApi.create` existente; a aba "Comandas" é derivada das mesas ocupadas (não há endpoint de listagem de comandas).

## Validações

| Verificação | Resultado |
|---|---|
| `pnpm --filter web typecheck` | ✅ passou |
| `pnpm --filter web lint` | ✅ sem avisos |
| `pnpm --filter web build` | ✅ passou (todas as rotas geradas) |
| `pnpm --filter web test` (jest) | ✅ 36/36 |

## Pendências

- **Não houve verificação visual em navegador** (extensão do Chrome indisponível na sessão); a validação se apoia em typecheck/lint/build/testes. Recomenda-se um passeio manual em desktop, tablet e mobile.
- Sem tela/backend para Estoque, Usuários, Configurações, Delivery/Retirada no PDV, atalhos QR, "Sugestões"/"Importar cardápio com foto" — aparecem desabilitados ou foram omitidos.
- Chips de tempo (ex.: 40min/15min) só existem no `/demo` (fictícios); não há dado real para eles.
- Login, registro e cardápio público mantêm o visual claro anterior.


---

# Fase 09 — Controle de estoque real — 2026-09-28

Primeiro módulo real de estoque, **por unidade (Branch)**, integrado a Produtos e Pedidos. Documentação completa em `docs/INVENTORY.md`.

## O que foi entregue

- **Models** (`schema.prisma`):
  - `InventoryItem`, `InventoryBalance`, `StockMovement`, `ProductRecipe`, `ProductRecipeItem`;
  - enums `InventoryUnit`, `StockMovementType`, `StockReferenceType`;
  - `Branch.allowNegativeStock`.
- **Migration** `20260928232435_inventory`: tabelas, constraints e o trigger que torna `stock_movements` append-only.
- **API** `/v1/inventory/*`:
  - itens, saldos, produtos, movimentos, fichas técnicas e configuração;
  - permissões `inventory.read|create|update|movement.create|recipe.manage` no seed;
  - OWNER, ADMIN e MANAGER com todas; CASHIER e KITCHEN só leitura; WAITER sem acesso.
- **Integração com pedidos**:
  - baixa em `PENDING → CONFIRMED` dentro da mesma transação da mudança de status, com lock da linha do pedido;
  - baixa na criação para o checkout de comanda (nasce COMPLETED);
  - estorno `SALE_REVERSAL` no cancelamento pós-baixa.
  - `OrdersService.updateStatus` foi refatorado para transação + `FOR UPDATE`. PublicOrders, PDV, Painel, KDS e comandas seguem passando em todos os e2e.
- **Frontend**:
  - `/dashboard/estoque` com abas Produtos, Insumos, Movimentações e Compras (em breve);
  - toggle "Permitir estoque negativo", alerta de estoque baixo;
  - dialogs de insumo, movimento (entrada, saída, ajuste) e ficha técnica;
  - item "Estoque" liberado no menu para OWNER, ADMIN, MANAGER, CASHIER e KITCHEN.
- **Demo**: `/demo/estoque` com dados fictícios em `lib/demo/inventory.ts` (67 produtos, 12 insumos, 4 com estoque baixo ou zerado, 10 movimentos), sem API.

## Decisões

- **Quantidade**: `DECIMAL(14,3)` + `Prisma.Decimal`, nunca float.
- **Custo**: centavos inteiros; custo médio ponderado recalculado só no backend.
- **Unidade de estoque imutável**: a ficha aceita unidade compatível (G em vez de KG, ML em vez de L), que o backend converte.
- **Baixa**: acontece na confirmação do pedido. Com estoque negativo desligado, falta de insumo **bloqueia a confirmação** (`409 INSUFFICIENT_STOCK`) e o pedido fica PENDING. O mesmo vale para o fechamento de comanda. Produtos sem ficha técnica não são afetados.
- **Idempotência**: unique `(referenceType, referenceId, inventoryItemId, type)` + lock do pedido.
- **Concorrência**: `INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE` na linha de saldo, travada em ordem determinística.

## Validações (executadas de verdade, Postgres + Redis via Docker)

| Verificação | Resultado |
|---|---|
| `pnpm db:generate` / `db:migrate` / `db:constraints` / `db:seed` | ✅ |
| `pnpm typecheck` | ✅ api + web |
| `pnpm lint` | ✅ sem avisos |
| `pnpm test` | ✅ api 53/53 (13 novos em `inventory-calculations.spec.ts`), web 39/39 (3 novos) |
| e2e `inventory.e2e-spec.ts` | ✅ 20/20 |
| e2e suíte completa (13 suítes) | ✅ 138/138 — sem regressão em pedidos, KDS, PDV, caixa, comandas e isolamento |
| `pnpm build` | ✅ api + web (`/dashboard/estoque`, `/demo/estoque` gerados) |

O e2e cobre:

- **Insumos:** criar e atualizar insumo, com unidade imutável e SKU único.
- **Movimentos:** entrada com custo médio, saída, ajuste e estoque mínimo.
- **Saldo negativo:** estoque insuficiente, estoque negativo bloqueado e habilitado.
- **Imutabilidade:** sem rota de update/delete, e o trigger do banco rejeita a alteração.
- **Consultas:** filtros de movimentações.
- **Concorrência:** saldo 5 com saídas simultâneas de 4 e 3 (só uma aceita), mais 8 entradas simultâneas.
- **Ficha técnica:** conversão e rejeição de unidade.
- **Baixa automática:** baixa em CONFIRMED, idempotência com confirmações concorrentes e reprocessamento, confirmação bloqueada por falta de insumo, estorno no cancelamento, produto sem ficha.
- **Checkout de comanda:** baixa junto com o fechamento.
- **Acesso:** cross-tenant, cross-branch e RBAC.

Verificação visual: `/demo/estoque` conferido no navegador. `/dashboard/estoque` **não** foi aberto no navegador, porque exige login com a API. A tela está coberta por typecheck e build, e o backend por e2e.

## Pendências

- Usuários já logados precisam sair e entrar de novo para receber as permissões `inventory.*` (elas vão no JWT).
- A opção "Quando o estoque zerar: pausar produto / vender sob encomenda" ficou só visual: `Product.active` é por tenant, e pausar por unidade exige modelagem própria.
- Fora do escopo desta fase: compras, fornecedores, notas, transferência entre unidades, lote/FIFO, validade e CMV.


---

# Nova identidade visual global — 2026-09-28

Troca **somente de frontend** (`apps/web`): paleta oficial, tipografia e tokens centralizados. Backend, API, Prisma, auth, RBAC, multi-tenancy e regras de negócio (pedidos, PDV, caixa, estoque) não foram tocados. Detalhes, tabela de contraste e regras de uso em `docs/UI_DESIGN_SYSTEM.md`.

## O que mudou

- **Paleta** `#020001` preto, `#9F6118` caramelo, `#C88A3A` dourado, `#E5C08A` bege, `#F6E7CF` creme, declarada uma única vez em `app/globals.css`. Superfícies e bordas são bege sobre preto em baixa opacidade, sem sexta cor de marca. Verde, amarelo, vermelho e azul ficam só como estados funcionais.
- **Tokens semânticos** (`--background`, `--foreground`, `--surface*`, `--border*`, `--primary*`, `--accent*`, `--muted*`) expostos no `tailwind.config.ts`. Os componentes passaram a usar `bg-primary`, `text-accent`, `text-muted-foreground`, `bg-background`, `text-foreground` etc.
- **Tipografia**: títulos `h1–h3` em Georgia; interface em Aptos, com fallbacks `Segoe UI`, Arial. Nenhum arquivo de fonte instalado.
- **Componentes base** (`components/ds/*`) e **App Shell** (`components/shell/*`) atualizados; as páginas herdam deles. Sidebar preta com item ativo dourado + marcador caramelo; botão primário caramelo; preços em dourado.
- **KDS**: destaque por status com rótulo em texto e ícone, para não depender só da cor. Badges de status ganharam os tons `brand` (dourado) e `primary` (caramelo).
- **Páginas atualizadas**: `/dashboard` (+ pedidos, pedido, cardápio, cozinha, PDV, caixa, estoque, mesas, comanda), `/demo/*` (aviso "Modo demonstração" mantido), e também login, cadastro, home e cardápio público / carrinho / checkout / acompanhamento, que ainda estavam na paleta clara antiga.
- Sem nenhuma cor `zinc`/`green`/`red`/`amber`/`indigo`/`sky`/`purple` restante em `app/` e `components/`.

## Validações (executadas)

| Verificação | Resultado |
|---|---|
| `pnpm --filter web typecheck` | ✅ |
| `pnpm --filter web lint` | ✅ sem avisos |
| `pnpm --filter web test` | ✅ 39/39 |
| `pnpm --filter web build` | ✅ 21 rotas geradas |
| Verificação visual no navegador | ✅ `/demo`, `/demo/pdv`, `/demo/cozinha`, `/demo/estoque`, `/login`; e, logado numa conta de teste local, `/dashboard`, `/dashboard/estoque`, `/dashboard/cardapio`, `/dashboard/pedidos`, `/dashboard/pdv`, `/dashboard/caixa`, `/dashboard/mesas` |

## Problemas encontrados e pendências

- O botão primário (creme sobre o caramelo oficial) mede 4,11:1: passa para texto grande e componentes de UI, mas fica abaixo de 4,5:1 para texto pequeno. Foi mantido o tom oficial e documentado.
- Não foram conferidos visualmente: `/dashboard/cozinha` real (precisa de pedidos ativos; o mesmo componente foi visto no demo), `/dashboard/pedidos/[id]`, `/dashboard/mesas/[tableId]`, o cardápio público (`/menu/[slug]`) e o checkout. Todos usam os mesmos tokens e passam typecheck e build.
- O servidor dev do Next não recarrega mudanças de `tailwind.config.ts`; após trocar tokens, reinicie com `.next` limpo.
- Algumas extensões de "modo escuro" do navegador recolorem a página; o app envia `<meta name="darkreader-lock">` para evitar isso.


---

# Fase — Estoque profissional — 2026-09-29

O módulo de estoque evoluiu de controle básico para central operacional, **por unidade**, reaproveitando o que a Fase 09 já tinha correto: ledger com lock, decimal, baixa na confirmação e idempotência. A referência completa está em `docs/INVENTORY.md`.

## Entregue

- **Modelos:**
  - `InventoryItem` ganhou `maxStock`, `tracksExpiry` e `notes`;
  - `StockMovement` ganhou `origin`, `exitReason`, `supplierName`, `documentNumber`, `lotCode` e `expiresAt` (`reason` virou `notes`);
  - `ProductRecipeItem` ganhou `inputUnit`;
  - novos modelos `InventoryCount` e `InventoryCountItem`;
  - novos enums `StockMovementOrigin` e `StockExitReason`;
  - `SALE_REVERSAL` passou a se chamar `REVERSAL`, e `StockReferenceType` ganhou `INVENTORY_COUNT`.
- **Migration:** `20260929010000_inventory_professional`, escrita à mão para **preservar histórico** (rename de enum e de coluna, backfill de origem com o trigger de imutabilidade desligado só durante a migration). Os 212 movimentos existentes foram mantidos, e não há drift de schema.
- **API:**
  - novos endpoints `summary`, `alerts`, `recipes` (lista com custo e margem) e `inventory-counts`;
  - `movements` ganhou filtros de origem, usuário e busca;
  - a entrada ganhou fornecedor, documento, lote e validade; a saída ganhou motivo (enum);
  - o ajuste manual por `movements` foi removido (agora só via inventário), e `/products` foi substituído por `/recipes`.
- **Serviços:** o antigo `InventoryService` monolítico foi dividido em ledger, itens, movimentos, fichas, inventário e visão geral. `InventoryService` virou a fachada de integração com pedidos, com a mesma API, então `OrdersService` e `OrderCreationService` **não precisaram mudar**.
- **Custo e margem da ficha:** calculados no backend, em centavos.
- **Permissão nova:** `inventory.count` (OWNER, ADMIN e MANAGER).
- **Frontend:**
  - `/dashboard/estoque` com abas por rota: Visão geral, Insumos, Ficha técnica, Movimentações, Compras (em breve) e Inventário (`/dashboard/estoque/inventario`);
  - janelas de Nova entrada, Nova saída, Insumo e Ficha técnica;
  - confirmação antes do ajuste de inventário, toasts e estados de loading, empty e error.
- **Código sem comentários:** foram removidos os comentários dos arquivos modificados (`schema.prisma`, `seed.ts`, módulo de estoque, teste e2e, script de seed de desenvolvimento, cliente de API e telas do estoque).

## Validações (executadas de verdade)

| Comando | Resultado |
|---|---|
| `pnpm db:generate` | ✅ |
| `pnpm db:migrate` | ✅ já em sync (a migration nova foi aplicada com `prisma migrate deploy`, porque `migrate dev` recusa renomear enum/coluna sem perda de dados em modo não interativo) |
| `pnpm db:constraints` / `pnpm db:seed` | ✅ |
| `pnpm typecheck` | ✅ api + web |
| `pnpm lint` | ✅ sem avisos |
| `pnpm test` | ✅ api 60/60 (20 de regras puras de estoque), web 40/40 |
| `pnpm --filter api test:e2e` | ✅ 144/144 em 13 suítes (26 de estoque), sem regressão em pedidos, PDV, KDS, caixa e comandas |
| `pnpm --filter web test` | ✅ 40/40 |
| `pnpm build` | ✅ api + web (26 rotas; 6 de estoque) |
| Smoke HTTP na API real, conta de teste local | ✅ summary, alerts, recipes (custo e margem), movements e balances respondem com os dados migrados |

Problemas encontrados e corrigidos durante a fase:

- `prisma generate` falhou com a API rodando (DLL travada); passou depois de parar o processo.
- Um e2e esperava 6 unidades produzíveis; o correto era 10, e o teste foi corrigido, não o código.

## Pendências

- **Sem verificação visual no navegador:** a extensão do Chrome estava desconectada. A validação se apoia em typecheck, build, e2e e smoke HTTP.
- **Saídas antigas:** as saídas anteriores a esta fase foram migradas com motivo `OTHER`, porque antes o motivo era texto livre. Elas não entram em "Perdas no período".
- **Validade:** o alerta usa uma **estimativa** (saldo atribuído às entradas mais recentes), e não consumo por lote. FIFO/FEFO real exige uma tabela de lotes com saldo.
- **`/demo/estoque`:** continua com o layout de abas anterior. Não foi alterado nesta fase.
- **Permissões no token:** usuários logados precisam entrar de novo para receber `inventory.count`.
- **Fora do escopo:** compras e fornecedores completos, transferência entre unidades, CMV, previsão de demanda e integração contábil.

---

# Perfil do restaurante (Do'cê Hamburgueria e Confeitaria)

Página de perfil de estabelecimento, somente frontend. Detalhes em `docs/RESTAURANT_PROFILE.md`.

- **Rotas:** `/dashboard/restaurante` (real, gestão) e `/demo/restaurante` (apresentação, sem API). Item "Restaurante" adicionado aos menus de `/dashboard` e `/demo`.
- **Componentes:** `RestaurantProfileView` e `EditProfileDialog` em `components/restaurante/`.
- **Dados:** nome, slug, razão social e documento vêm de `GET /tenants/current`; vendas, pedidos e ticket médio do dia vêm de `GET /orders`. Endereço, horários, canais, descrição e as demais métricas são demonstrativos e ficam centralizados em `lib/demo/restaurant-profile.ts`, com o selo "Dados demonstrativos".
- **Edição:** só funciona localmente no modo demo; no modo real o formulário é somente leitura.
- **Sem alterações** em backend, banco, autenticação, RBAC, multi-tenancy, pedidos, PDV, KDS, caixa ou estoque. Em `nav.ts` foram removidos os comentários existentes.

## Validações

| Comando | Resultado |
|---|---|
| `pnpm --filter web typecheck` | ✅ |
| `pnpm --filter web lint` | ✅ sem avisos |
| `pnpm --filter web build` | ✅ inclui `/dashboard/restaurante` e `/demo/restaurante` |

## Pendências

- Sem verificação visual no navegador nesta rodada; a validação se apoia em typecheck, lint e build.
- Persistência do perfil (telefone, e-mail, endereço, horários, redes sociais) exige backend novo, fora do escopo.

