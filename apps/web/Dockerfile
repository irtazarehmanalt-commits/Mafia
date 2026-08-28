# --- Build stage ------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/game-engine/package.json ./packages/game-engine/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace @mafia/web --include-workspace-root

COPY packages ./packages
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here
# rather than only at runtime.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_SOCKET_SERVER_URL=http://localhost:4000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SOCKET_SERVER_URL=$NEXT_PUBLIC_SOCKET_SERVER_URL

RUN npm run build --workspace @mafia/web

# --- Runtime stage ----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S mafia && adduser -S mafia -G mafia

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages

USER mafia
WORKDIR /app/apps/web
EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]
