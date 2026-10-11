# syntax=docker/dockerfile:1

# API image (NestJS + Prisma). Build context: the repository root.
#
#   docker build -f deploy/api.Dockerfile --target runtime  -t restaurant-saas-api .
#   docker build -f deploy/api.Dockerfile --target migrator -t restaurant-saas-api-migrator .
#
# Two images come out of this file on purpose:
#   runtime   what serves requests. Production dependencies only, NODE_ENV=production, non-root.
#             It NEVER touches the schema: starting it does not run migrations or the seed.
#   migrator  a one-shot job with the Prisma CLI: `prisma migrate deploy` and then the seed of
#             roles and permissions (idempotent, no tenants, users or demo data). It runs against
#             whatever DATABASE_URL it is given, so whoever starts it decides which database.
# A third target, e2e, is a test tool and is never deployed (see deploy/README.md).
#
# Versions are pinned here and nowhere else. Node 24.14.1 and pnpm 9.12.0 are the versions the
# test suites were run with; package.json asks for Node >= 20.
ARG NODE_VERSION=24.14.1
ARG PNPM_VERSION=9.12.0

# ---- base: Debian 12 (glibc), OpenSSL 3 for the Prisma engine, pnpm through corepack ----
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV CI=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---- manifests: everything pnpm needs to resolve the workspace, and nothing else ----
# The lockfile covers every workspace project, so every package.json has to be present even
# though only the API and what it depends on are installed.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/

# ---- build: all dependencies (the compiler and the Prisma CLI are devDependencies) ----
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "api..."
COPY packages packages
COPY apps/api apps/api
# `prisma generate && nest build`. Output: apps/api/dist/src/main.js and dist/prisma/seed.js.
RUN pnpm --filter api build
# The generated Prisma Client (with the query engine for this OS) lives inside pnpm's store
# directory, next to @prisma/client. Keep a copy at a fixed path for the runtime image.
RUN cp -rL "$(dirname "$(node -p "require.resolve('@prisma/client/package.json', { paths: ['/app/apps/api'] })")")/../../.prisma/client" /prisma-client

# ---- prod-deps: what the running API needs, installed the way production installs ----
# NODE_ENV=production + --prod: no devDependencies. --ignore-scripts: the root `prepare`
# script calls husky, a devDependency that is not there; argon2 ships a prebuilt binary and
# needs no install step.
FROM manifests AS prod-deps
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "api..."
RUN --mount=type=bind,from=build,source=/prisma-client,target=/prisma-client \
  dest="$(dirname "$(node -p "require.resolve('@prisma/client/package.json', { paths: ['/app/apps/api'] })")")/../../.prisma" \
  && mkdir -p "$dest" && rm -rf "$dest/client" && cp -r /prisma-client "$dest/client"

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/api/dist /app/apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Ready means PostgreSQL and Redis answered, not that the port is open.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/main.js"]

# ---- migrator ----
FROM build AS migrator
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js"]

# ---- e2e: the end-to-end suite on Linux. It creates tenants and data on every run: give it a
# database of its own, never one that is in use. ----
FROM build AS e2e
ENV NODE_ENV=test
# trust-proxy.e2e-spec.ts checks the API against the header the frontend's server really sends.
COPY apps/web/server /app/apps/web/server
WORKDIR /app/apps/api
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js && node_modules/.bin/jest --config ./test/jest-e2e.json --ci --cacheDirectory /tmp/jest"]
