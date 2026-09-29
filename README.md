# Restaurant SaaS — Plataforma de Gestão para Restaurantes

> **Fase atual: 01 — Fundação, Autenticação, Multi-tenancy e RBAC.**
> Cardápio, pedidos, PDV, caixa, estoque, pagamentos e demais módulos de negócio
> ainda **não** existem neste código — ver `docs/PROJECT_STATUS.md` e o roadmap
> no fim deste arquivo.

## Visão geral

SaaS multi-tenant para restaurantes. Cada restaurante é um **Tenant** isolado,
com uma ou mais **Branches** (unidades), usuários e (nas próximas fases)
cardápio, pedidos, caixa, estoque etc.

## Arquitetura

Monólito modular em monorepo (não microsserviços). Backend organizado por
domínio (`auth`, `users`, `tenants`, `branches`, `audit`, `health`), preparado
para eventualmente extrair um módulo como serviço independente sem reescrever
o resto. Detalhes em `docs/architecture.md`.

```
apps/
  api/   # NestJS + Prisma + PostgreSQL
  web/   # Next.js (App Router) + Tailwind
packages/
  types/          # tipos TS compartilhados entre api e web
  ui/              # componentes React compartilhados (vazio na Fase 01)
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
```

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
pnpm --filter api test        # testes unitários (guards, utilitários — sem banco)
pnpm --filter api test:e2e    # testes e2e (register/login/refresh/logout, isolamento de tenant)
```

Os testes e2e sobem uma aplicação Nest real e usam o `DATABASE_URL` do
ambiente — aponte para um banco de teste descartável antes de rodá-los.

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

## Roadmap (não implementar sem aprovação explícita)

Fase 01 (atual) → 02 Configurações → 03 Cardápio → 04 Carrinho/Checkout →
05 Pedidos → 06 KDS → 07 PDV → 08 Caixa → 09 Mesas/Comandas → 10 Totem →
11 Pagamentos → 12 NFC-e → 13 Estoque → 14 Delivery → 15 CRM/Fidelidade →
16 Fiado → 17 WhatsApp/IA → 18 PWA/Push → 19 Relatórios → 20 SaaS Billing.
