# syntax=docker/dockerfile:1

# TEST TOOL. NEVER DEPLOY THIS IMAGE AND NEVER GIVE IT A DATABASE THAT IS IN USE.
#
# The end-to-end suite of the API on Linux. Starting it applies the migrations and the seed and
# then runs every test against DATABASE_URL, creating restaurants, users and orders on each
# run. It lives in a file of its own so that no build of the production image
# (deploy/api.Dockerfile) can ever select it. Build context: the repository root.
#
#   docker compose -f deploy/compose.yml --profile e2e run --rm e2e
#
# The stages up to `build` are the same as in deploy/api.Dockerfile.
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

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "api..."
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter api build

FROM build AS e2e
ENV NODE_ENV=test
# trust-proxy.e2e-spec.ts checks the API against the header the frontend's server really sends.
COPY apps/web/server /app/apps/web/server
WORKDIR /app/apps/api
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js && node_modules/.bin/jest --config ./test/jest-e2e.json --ci --cacheDirectory /tmp/jest"]
