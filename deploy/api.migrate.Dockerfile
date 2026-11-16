# syntax=docker/dockerfile:1

# Migration job of the API: a one-shot image that changes the SCHEMA of a database and then
# exits. It is not the API and never serves requests. Build context: the repository root.
#
#   docker build -f deploy/api.migrate.Dockerfile -t restaurant-saas-api-migrate .
#   docker run --rm -e DATABASE_URL=... restaurant-saas-api-migrate                                      (release)
#   docker run --rm -e DATABASE_URL=... restaurant-saas-api-migrate node /app/deploy/migrate.js status
#
# It carries the Prisma CLI of the lockfile (the same version as the @prisma/client the API
# runs with), prisma/schema.prisma, prisma/migrations and the compiled seed. What it does is in
# deploy/migrate.js: `release` (the default) applies the pending migrations and then the seed
# of roles and permissions; `status`, `migrate` and `seed` do one thing each.
#
# It acts on whatever DATABASE_URL it is given: whoever starts it decides which database.
# Run it once per release, BEFORE the API starts, never from the API's own start command.
#
# The stages up to `build` are the same as in deploy/api.Dockerfile, on purpose: the job is
# built from the same sources, lockfile and pinned versions as the API it migrates for.
ARG NODE_VERSION=24.14.1
ARG PNPM_VERSION=9.12.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV CI=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/

# All dependencies: the Prisma CLI is a devDependency.
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "api..."
COPY packages packages
COPY apps/api apps/api
# `prisma generate && nest build`: the seed runs compiled, from dist/prisma/seed.js.
RUN pnpm --filter api build

# ---- migrate: keep this the LAST stage of the file ----
FROM build AS migrate
ENV NODE_ENV=production
COPY deploy/migrate.js /app/deploy/migrate.js
WORKDIR /app/apps/api
USER node
CMD ["node", "/app/deploy/migrate.js", "release"]
