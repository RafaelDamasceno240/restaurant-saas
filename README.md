# Restaurant SaaS — Plataforma de Gestão para Restaurantes

> **Estado atual (auditoria de 2026-09-30):** MVP operacional de balcão, salão e
> estoque. **IMPLEMENTADO:** autenticação, RBAC, multi-tenancy, unidades,
> cardápio administrativo e público, carrinho, checkout público, pedidos, KDS,
> PDV, caixa, mesas, comandas, estoque e compras. **PARCIAL:** pagamentos (só registro
> interno, sem gateway), delivery (taxa, despacho, falha/reentrega, confirmação, entregador interno e histórico; sem mapas/GPS nem entregador externo),
> CRM (só a base de clientes: cadastro, histórico e métricas; sem fidelidade/campanhas), perfil do restaurante (leitura; edição não persiste). **NÃO IMPLEMENTADO:**
> NFC-e, fidelidade/cashback, WhatsApp/IA, relatórios, cobrança SaaS. Detalhes e
> evidências em `docs/PROJECT_STATUS.md`.

## Visão geral

SaaS multi-tenant para restaurantes. Cada restaurante é um **Tenant** isolado,
com uma ou mais **Branches** (unidades), usuários, cardápio, pedidos, caixa,
mesas, comandas e estoque.

## Arquitetura

Monólito modular em monorepo (não microsserviços). Backend organizado por
domínio (`auth`, `users`, `tenants`, `branches`, `audit`, `health`, `categories`,
`products`, `public-menu`, `public-orders`, `order-creation`, `orders`, `pos`,
`payments`, `cash`, `tables`, `tabs`, `inventory`, `purchases`), preparado
para eventualmente extrair um módulo como serviço independente sem reescrever
o resto. Detalhes em `docs/architecture.md`.

```
apps/
  api/   # NestJS + Prisma + PostgreSQL
  web/   # Next.js (App Router) + Tailwind
packages/
  types/          # tipos TS compartilhados entre api e web
  ui/              # componentes React compartilhados (vazio; a UI vive em apps/web/components/ds)
  config/          # constantes não-sensíveis compartilhadas
  eslint-config/   # config de lint compartilhada
  tsconfig/        # tsconfigs base compartilhados
```

## Stack

- **Backend:** Node.js, TypeScript, NestJS, Prisma, PostgreSQL, Redis, JWT, Argon2
- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, TanStack Query
- **Monorepo:** pnpm workspaces + Turborepo
- **Infra local:** Docker Compose (PostgreSQL + Redis)

## Requisitos

- Node.js 20+
- pnpm 9+ (`corepack enable` habilita a versão do `packageManager`)
- Docker + Docker Compose (para Postgres/Redis locais)

## Instalação

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Ajuste os segredos em `apps/api/.env` (`JWT_ACCESS_SECRET` e
`JWT_REFRESH_SECRET` precisam de ao menos 32 caracteres cada).

## Infraestrutura local (Docker)

```bash
docker compose up -d
```

Sobe PostgreSQL (5432) e Redis (6379) com healthcheck.

## Banco de dados

```bash
pnpm db:generate   # gera o Prisma Client
pnpm db:migrate    # cria/aplica migrations (ambiente de desenvolvimento)
pnpm db:seed       # popula roles + permissions (nenhum dado fictício de negócio)
pnpm db:constraints # (fatia 08) índice parcial + trigger de imutabilidade do caixa — rodar após db:migrate
pnpm db:tabs-constraints # (fatia 09) índice parcial de uma comanda aberta por mesa — rodar após db:migrate
```

Os índices parciais e o trigger do caixa agora também estão na migration
`20260930000000_partial_indexes_and_cash_immutability`, então `prisma migrate
deploy` já os cria. Os scripts `db:constraints` e `db:tabs-constraints`
continuam disponíveis e idempotentes.

## Executando

```bash
pnpm dev           # api (porta 4000) + web (porta 3000) em paralelo
pnpm dev:api       # somente a API
pnpm dev:web       # somente o frontend
```

- API: http://localhost:4000/v1
- Swagger (fora de produção): http://localhost:4000/docs
- Frontend: http://localhost:3000

## Testes

```bash
pnpm --filter api test        # unitários da API (sem banco)
pnpm --filter web test        # unitários do frontend
pnpm --filter api test:e2e    # e2e: 23 suítes cobrindo auth, tenant, cardápio, pedidos, KDS, PDV, caixa, mesas, comandas, estoque, compras, delivery e clientes
```

Os testes e2e sobem uma aplicação Nest real e usam o `DATABASE_URL` do
ambiente — aponte para um banco de teste descartável antes de rodá-los.

### Preparar o banco descartável dos e2e

Um banco novo (só com as migrations) **não basta**: as roles e permissões (RBAC)
precisam estar semeadas. O `POST /v1/auth/register` — usado pelos e2e para criar
cada tenant de teste — depende delas; sem o seed ele responde `500` e as suítes
falham em massa (observado na validação do CRM: 41 de 41 testes de clientes
falharam até o seed ser executado). O seed (`prisma/seed.ts`) cria apenas roles,
permissões e a ligação entre elas; não cria tenants, usuários nem produtos.

```bash
# exemplo: banco e Redis separados do DEV (ajuste usuário/senha/porta ao seu ambiente)
export DATABASE_URL='postgresql://USUARIO:SENHA@localhost:5432/restaurant_saas_e2e?schema=public'
export REDIS_URL='redis://localhost:6379/1'

pnpm --filter api prisma:deploy             # migrations
pnpm --filter api prisma:seed               # roles/permissões (obrigatório para os e2e)
pnpm --filter api prisma:constraints        # scripts SQL de caixa e comandas
pnpm --filter api prisma:tabs-constraints   # (aplicados na validação do CRM; ver prisma/sql)
pnpm --filter api test:e2e
```

Rode o seed novamente sempre que adicionar permissões novas ao `prisma/seed.ts`
(por exemplo, as `customers.*` do CRM), e nunca aponte os e2e para o banco DEV:
eles criam tenants e dados a cada execução.

## Lint, typecheck e build

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Estrutura de pastas (resumo)

Ver `docs/architecture.md` para a árvore completa e as decisões por trás dela.

## Documentação adicional

- `docs/architecture.md` — arquitetura, módulos, padrão de erros, configuração
- `docs/database.md` — modelos, relacionamentos, índices, decisões de schema
- `docs/authentication.md` — estratégia de tokens, RBAC, segurança
- `docs/multi-tenancy.md` — como o isolamento de tenant é garantido
- `docs/PROJECT_STATUS.md` — relatório técnico do estado real do projeto
- `docs/DEMO_MODE.md` — modo demonstração (`/demo/*`, dados fictícios, sem API)
- `docs/RESTAURANT_PROFILE.md` — perfil do restaurante (real x demonstrativo)
- `docs/INVENTORY.md`, `docs/PURCHASES.md`, `docs/DELIVERY.md`, `docs/CRM.md`, `docs/CASH_REGISTER_PLAN.md`, `docs/UI_DESIGN_SYSTEM.md`

## Roadmap (não implementar sem aprovação explícita)

Fase 01 (concluída) → 02 Configurações → 03 Cardápio → 04 Carrinho/Checkout →
05 Pedidos → 06 KDS → 07 PDV → 08 Caixa → 09 Mesas/Comandas → 10 Totem →
11 Pagamentos → 12 NFC-e → 13 Estoque → 14 Delivery → 15 CRM/Fidelidade →
16 Fiado → 17 WhatsApp/IA → 18 PWA/Push → 19 Relatórios → 20 SaaS Billing.
