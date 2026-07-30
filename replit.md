# Career Terminal

A Node.js/TypeScript REST API backend for job seeking and career management.

## Stack

- **Runtime:** Node.js ≥ 20, TypeScript
- **Framework:** Express 5
- **ORM:** Prisma (PostgreSQL)
- **Queue/Workers:** BullMQ + Redis
- **Auth:** Google OAuth2 + JWT
- **Storage:** AWS S3 (MinIO-compatible for local dev)
- **Observability:** OpenTelemetry (tracing + metrics)

## Project Structure

```
src/
  config/         # App config, database, environment
  domain/         # Domain models
  errors/         # Custom error classes
  infrastructure/ # Health, telemetry, security, logger
  lib/            # Shared utilities (logger, etc.)
  middleware/      # Express middleware
  repository/     # Data access layer
  routes/         # Express route handlers
  services/       # Business logic services
  types/          # TypeScript types
  utils/          # Utility functions
  workers/        # Background workers (Gmail sync, etc.)
  __tests__/      # Jest tests
prisma/           # Prisma schema and migrations
scripts/          # Backfill, CI, diagnostics scripts
k8s/              # Kubernetes manifests
```

## Running Locally

Copy `.env.example` to `.env` and fill in values. Required services:

- **PostgreSQL** — set `DATABASE_URL`
- **Redis** — set `REDIS_HOST`, `REDIS_PORT`
- **Google OAuth** — set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- **S3/MinIO** — set AWS or MinIO credentials
- **Secrets** — `JWT_SECRET`, `INTERNAL_API_KEY`, `ENCRYPTION_KEY`

```bash
npm install
npm run db:generate    # generate Prisma client
npm run db:migrate     # run migrations
npm run dev            # start dev server (tsx watch)
```

Worker process (separate terminal):
```bash
npm run worker:dev
```

## Key Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start API server with hot reload |
| `npm run worker:dev` | Start background workers with hot reload |
| `npm run build` | Compile TypeScript |
| `npm test` | Run Jest tests |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |
| `npm run db:studio` | Open Prisma Studio |

## User Preferences

<!-- Record user preferences here as they are expressed -->
