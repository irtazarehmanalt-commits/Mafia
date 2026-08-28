# --- Build stage ------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Copy only manifests first so dependency installation is cached independently
# of source changes.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/game-engine/package.json ./packages/game-engine/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace @mafia/server --include-workspace-root

COPY packages ./packages
COPY apps/server ./apps/server

# Prisma client must exist before the TypeScript build references it.
RUN npx prisma generate --schema apps/server/prisma/schema.prisma
RUN npm run build --workspace @mafia/server

# --- Runtime stage ----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Never run the game server as root.
RUN addgroup -S mafia && adduser -S mafia -G mafia

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/server/prisma ./prisma
COPY --from=builder /app/apps/server/package.json ./package.json

USER mafia
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
