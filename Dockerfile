# Production image for the Next.js app. PostgreSQL is a separate managed
# service: compose.dev.yaml is for local development only and is not used here.
#
#   docker build -t my-app .
#   docker build --target migrator -t my-app-migrate .
#
# Run the migrator once per release, then start the app. See docs/deployment.md.

ARG NODE_VERSION=22-alpine

# --- Build Go backend for native deployment bundle ----------------------------
FROM golang:1.25-alpine AS go-builder
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /noc-backend ./cmd/server
# --- Build dependencies ------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# --- Build the standalone server ---------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# next build reads DATABASE_URL and BETTER_AUTH_SECRET while collecting page
# data, so both must parse. These placeholders stay on this one command: they
# are not stored in image metadata, and server code reads process.env when a
# request arrives. Supply real values to the running container, not the build.
# Coolify turns every env var into an ARG in each stage, so runtime values
# (DEVICE_SECRET, OSRM_BASE_URL, GENIEACS_NBI_URL, ...) leak into this RUN and
# src/lib/env.ts rejects them while collecting page data. env -i starts the
# build from an empty environment so only the placeholders below are seen.
# NEXT_PUBLIC_GO_* are inlined into the browser bundle at build time, so they
# must pass through; empty falls back to localhost in api-client/auth-form.
ARG NEXT_PUBLIC_GO_API_URL=""
ARG NEXT_PUBLIC_GO_WS_URL=""
# The cache mount keeps Turbopack's .next/cache between deploys (warm build).
RUN --mount=type=cache,target=/app/.next/cache env -i \
    NEXT_PUBLIC_GO_API_URL="$NEXT_PUBLIC_GO_API_URL" \
    NEXT_PUBLIC_GO_WS_URL="$NEXT_PUBLIC_GO_WS_URL" \
    PATH="$PATH" \
    HOME=/root \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    BETTER_AUTH_SECRET=placeholder-for-build-only-replaced-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000 \
    DASHBOARD_DATA=demo \
    DATA_MODE=demo \
    NODE_OPTIONS="--max-old-space-size=4096" \
    npm run build

# --- Shared runtime: only the files the standalone server traced --------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NOC_PREBUILT_RELEASE=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat tar gzip \
 && addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p .next /tmp/noc-deploy-cache && chown -R nextjs:nodejs /app /tmp/noc-deploy-cache
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/systemd ./systemd
COPY --from=go-builder --chown=nextjs:nodejs /noc-backend ./noc-backend
# --- Migrator: apply committed SQL once per release --------------------------
# Uses MIGRATION_DATABASE_URL when set, otherwise DATABASE_URL. Built on deps,
# not runtime: it needs only node_modules + SQL + scripts, so a code change no
# longer re-copies node_modules or waits for next build.
FROM deps AS migrator
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node scripts ./scripts
USER node
CMD ["node", "scripts/migrate.mjs"]

# --- Studio: Drizzle Studio container ----------------------------------------
FROM deps AS studio
WORKDIR /app
COPY . .
ENV PORT=4983
EXPOSE 4983
CMD ["npx", "drizzle-kit", "studio", "--port", "4983", "--host", "0.0.0.0"]

# --- Runner: the app. Keep last so it stays the default build target ----------
FROM runtime AS runner
USER nextjs
EXPOSE 3000

# Liveness only: a static asset, so a database outage does not restart the app.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/icon.svg').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
