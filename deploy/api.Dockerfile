# syntax=docker/dockerfile:1

# API image (NestJS + Prisma): the PRODUCTION image, and nothing else. Build context: the
# repository root.
#
#   docker build -f deploy/api.Dockerfile -t restaurant-saas-api .
#
# This file has one deliverable, and it is the LAST stage on purpose: a build with no target
# (plain `docker build`, or a hosting platform that does not let you choose one) produces the
# image that serves requests. Production dependencies only, NODE_ENV=production, non-root.
# Starting it runs the API and nothing else: it NEVER applies migrations, runs the seed or
# runs tests. Those live in files of their own, so no build of this one can select them:
#   deploy/api.migrate.Dockerfile   one-shot job: migrations and the seed of roles/permissions
#   deploy/api.e2e.Dockerfile       test tool, never deployed
# `node deploy/verify-images.js` checks all of this against the images Docker really builds.
#
# Versions are pinned here and nowhere else. Node 24.14.1 and pnpm 9.12.0 are the versions the
# test suites were run with; package.json asks for Node >= 20. The three API Dockerfiles and
# deploy/web.Dockerfile must pin the same versions (verify-images.js fails if they differ).
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
# The client generated in the build stage, put where this install expects it. A plain COPY
# (no BuildKit-only mount), so any builder that understands multi-stage files can build this.
COPY --from=build /prisma-client /tmp/prisma-client
RUN dest="$(dirname "$(node -p "require.resolve('@prisma/client/package.json', { paths: ['/app/apps/api'] })")")/../../.prisma" \
  && mkdir -p "$dest" && rm -rf "$dest/client" && mv /tmp/prisma-client "$dest/client"

# ---- runtime: the image that serves requests. Keep this the LAST stage of the file. ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/api/dist /app/apps/api/dist
WORKDIR /app/apps/api
USER node
# Refuse to produce an image whose Prisma Client was not generated for this OS: without it the
# API would only fail at its first query, after the platform already called the deploy done.
RUN node -e "const fs = require('fs'), path = require('path'); const client = require('@prisma/client'); const dir = path.join(path.dirname(require.resolve('@prisma/client/package.json')), '..', '..', '.prisma', 'client'); if (!client.Prisma || !client.Prisma.ModelName || !fs.readdirSync(dir).some((file) => file.startsWith('libquery_engine-'))) { console.error('The generated Prisma Client is missing from the runtime image.'); process.exit(1); }"
EXPOSE 4000
# Ready means PostgreSQL and Redis answered, not that the port is open.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/main.js"]
