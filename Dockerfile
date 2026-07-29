# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# Compiles TypeScript and generates Prisma client.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20.19.3-alpine3.21 AS builder

WORKDIR /app

# Install dependencies first (layer cache — only invalidated when package*.json changes)
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci

# Copy source and compile
COPY prisma ./prisma/
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# Migration image: built and published as a separate tag by CI. It retains the
# Prisma CLI and schema only because migrations require them; the API/worker
# runtime image below intentionally does not include development tooling.
FROM builder AS migrator

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser
ENV NODE_ENV=production
ENTRYPOINT ["npx", "prisma", "migrate", "deploy"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime
# Minimal production image — no dev tools, no source, non-root user.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20.19.3-alpine3.21 AS runtime

LABEL org.opencontainers.image.title="career-terminal-api" \
      org.opencontainers.image.description="Career Terminal backend API" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.source="https://github.com/career-terminal/backend"

# tini: proper PID 1 signal forwarding (ensures SIGTERM reaches Node)
RUN apk add --no-cache tini

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled output and Prisma client from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check — uses /health which is intentionally unauthenticated
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/live || exit 1

# tini as PID 1 ensures correct signal forwarding to Node
ENTRYPOINT ["/sbin/tini", "--"]
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
