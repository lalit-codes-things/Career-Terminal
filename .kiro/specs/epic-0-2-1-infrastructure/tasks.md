# Epic 0.2.1 — Production Infrastructure Foundation
# Tasks

## Task 1: Docker — Dockerfile, Dockerfile.dev, .dockerignore
- [x] 1.1 Write production multi-stage Dockerfile (builder → runtime, non-root user, tini signal handler, healthcheck)
- [x] 1.2 Write Dockerfile.dev (single stage, hot-reload via tsx watch)
- [x] 1.3 Write .dockerignore

## Task 2: docker-compose.yml
- [x] 2.1 Write docker-compose.yml (api, postgres, pgbouncer, redis, minio services with healthchecks, depends_on, named volumes, bridge network)

## Task 3: PgBouncer config
- [x] 3.1 Write docker/pgbouncer/pgbouncer.ini (transaction pooling, env-based config)
- [x] 3.2 Write docker/pgbouncer/userlist.txt (env-variable placeholder, documented)

## Task 4: MinIO init script
- [x] 4.1 Write docker/minio/init-bucket.sh (wait for MinIO, create resume bucket)

## Task 5: Infrastructure module — src/infrastructure/config/env.schema.ts
- [x] 5.1 Write Zod environment schema covering all existing env vars plus new infrastructure vars (MINIO_*, PGBOUNCER_*)

## Task 6: Infrastructure module — src/infrastructure/health/
- [x] 6.1 Write src/infrastructure/health/health.types.ts (HealthStatus, HealthCheckResult, HealthReport interfaces)
- [x] 6.2 Write src/infrastructure/health/checkers/postgres.checker.ts
- [x] 6.3 Write src/infrastructure/health/checkers/redis.checker.ts
- [x] 6.4 Write src/infrastructure/health/checkers/storage.checker.ts (MinIO/S3)
- [x] 6.5 Write src/infrastructure/health/health.service.ts (aggregates all checkers)
- [x] 6.6 Write src/infrastructure/health/health.router.ts (GET /health, GET /ready, GET /live)

## Task 7: Infrastructure module — src/infrastructure/logger/
- [x] 7.1 Write src/infrastructure/logger/request-logger.middleware.ts (request ID, correlation ID, structured per-request logging)

## Task 8: Infrastructure module — src/infrastructure/bullmq/
- [x] 8.1 Write src/infrastructure/bullmq/bullmq.connection.ts (Redis connection abstraction for BullMQ, exportable for future queue registration)
- [x] 8.2 Write src/infrastructure/bullmq/bullmq.types.ts (shared BullMQ types/interfaces for future queues)

## Task 9: Infrastructure module — src/infrastructure/storage/
- [x] 9.1 Write src/infrastructure/storage/minio.client.ts (MinIO-compatible S3 client factory for local dev, configured via env vars)

## Task 10: Update src/index.ts — wire infrastructure
- [x] 10.1 Replace /health route with health router from Task 6
- [x] 10.2 Add request-logger middleware from Task 7
- [x] 10.3 Wire graceful shutdown to close Prisma and Redis (cache service)
- [x] 10.4 Add MINIO/ALLOWED_ORIGINS to .env.example

## Task 11: Kubernetes manifests
- [x] 11.1 Write k8s/namespace.yaml
- [x] 11.2 Write k8s/configmap.yaml
- [x] 11.3 Write k8s/secret.template.yaml
- [x] 11.4 Write k8s/deployment.yaml (resource requests/limits, liveness/readiness probes, non-root)
- [x] 11.5 Write k8s/service.yaml
- [x] 11.6 Write k8s/ingress.yaml
- [x] 11.7 Write k8s/networkpolicy.yaml
- [x] 11.8 Write k8s/hpa.yaml
- [x] 11.9 Write k8s/poddisruptionbudget.yaml

## Task 12: Baseline Prisma migration
- [x] 12.1 Write prisma/migrations/0_init/migration.sql (DDL for all existing tables from schema.prisma)

## Task 13: Verification
- [x] 13.1 Run npm run build — fix any errors
- [x] 13.2 Run npm run typecheck — fix any errors
- [x] 13.3 Run npm run lint — fix any errors
- [x] 13.4 Run npm test — confirm all 107 tests still pass
