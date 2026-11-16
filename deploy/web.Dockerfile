# syntax=docker/dockerfile:1

# Web image (Next.js). Build context: the repository root.
#
#   docker build -f deploy/web.Dockerfile --build-arg API_URL=https://<api-host>/v1 -t restaurant-saas-web .
#
# API_URL is where the API lives as seen FROM THIS CONTAINER, ending in /v1. It is needed twice:
#   - at build time: Next writes the destination of the /api rewrite into the build output, so
#     an image is built for one API address;
#   - at run time: Server Components call the API directly (apps/web/lib/api-client.ts).
# The browser never sees it: it only talks to this server, under /api.
#
# Same pinned versions as deploy/api.Dockerfile.
ARG NODE_VERSION=24.14.1
ARG PNPM_VERSION=9.12.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1
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

# ---- build: all dependencies (TypeScript, Tailwind and PostCSS are devDependencies) ----
FROM manifests AS build
ARG API_URL
RUN test -n "$API_URL" || (echo "API_URL build argument is required, e.g. http://api:4000/v1" >&2 && exit 1)
ENV API_URL=${API_URL}
RUN pnpm install --frozen-lockfile --filter "web..."
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter web build && rm -rf apps/web/.next/cache

# ---- prod-deps: installed the way production installs (see deploy/api.Dockerfile) ----
FROM manifests AS prod-deps
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "web..."

# ---- runtime ----
FROM base AS runtime
ARG API_URL
ENV NODE_ENV=production
ENV API_URL=${API_URL}
ENV PORT=3000
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/web/.next /app/apps/web/.next
COPY --chown=node:node apps/web/public /app/apps/web/public
COPY --chown=node:node apps/web/next.config.js /app/apps/web/next.config.js
# The HTTP server in front of Next: appends each client's address to X-Forwarded-For.
COPY --chown=node:node apps/web/server.js /app/apps/web/server.js
COPY --chown=node:node apps/web/server /app/apps/web/server
WORKDIR /app/apps/web
USER node
EXPOSE 3000
# Healthy means two things: the login page renders, and a call through the /api rewrite reaches
# the API (which answers 401 to an anonymous /auth/me; a 5xx means the proxy cannot reach it).
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "const base = 'http://127.0.0.1:3000'; Promise.all([fetch(base + '/login'), fetch(base + '/api/auth/me')]).then(([page, api]) => process.exit(page.ok && api.status === 401 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
