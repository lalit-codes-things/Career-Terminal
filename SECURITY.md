# Epic 0.1 — Security Hardening Report

**Status:** Complete  
**TypeScript:** ✅ 0 errors  
**Tests:** 97 passed — 10 pre-existing failures (unrelated to security)  

---

## Files Changed

| File | Change |
|---|---|
| `src/index.ts` | Added `trust proxy`, `helmet`, `cors`, `compression`, body-size limit (`1mb`), structured graceful shutdown, `unhandledRejection` / `uncaughtException` handlers |
| `src/middleware/rate-limiter.ts` | Replaced in-memory store with Redis-backed `rate-limiter-flexible` (memory fallback when Redis unavailable). Same public API — no callers broken |
| `src/middleware/internal-api.ts` | **New.** `requireInternalApiKey` middleware — guards server-to-server endpoints with `x-internal-api-key` header |
| `src/routes/auth.routes.ts` | `POST /auth/token` now requires `x-internal-api-key` + rate limited to 5/15 min; `POST /auth/refresh` rate limited to 20/15 min |
| `src/routes/integrations.routes.ts` | Restored `requireAuth` on `GET /gmail/connect`; `userId` now derived from JWT (not query param); dead `userId` query schema removed |
| `src/config/index.ts` | Added `validateSecrets()` — crashes at startup if `JWT_SECRET` < 32 chars, `ENCRYPTION_KEY` is all-zeros in production, or `INTERNAL_API_KEY` is missing in production |
| `src/lib/logger.ts` | Added 14 keys to `SENSITIVE_KEYS`: `password`, `secret`, `authorization`, `cookie`, `encryptionKey`, `encryption_key`, `apiKey`, `api_key`, `internalApiKey`, `internal_api_key`, `jwtSecret`, `jwt_secret`, `refreshTokenEncrypted`, `accessTokenEncrypted`, `stack` |
| `src/services/queue/workers/index.ts` | Wrapped `startAllWorkers()` in try/catch with `process.exit(1)` on failure |
| `src/__tests__/security.test.ts` | Rewrote stale tests — now validates JWT rejection, Basic-scheme rejection, test escape-hatch, and async rate limiter |
| `src/__tests__/integrations.routes.test.ts` | Updated to use `x-user-id` test header; asserts 401 for unauthenticated connect; asserts userId not accepted via query param |
| `.env.example` | Added `INTERNAL_API_KEY` and `ALLOWED_ORIGINS` documentation |

---

## Security Improvements

### Critical Findings — All Resolved ✅

| Finding | Fix |
|---|---|
| `POST /auth/token` publicly reachable — anyone with a UUID could issue tokens | Gated with `requireInternalApiKey` (shared secret header) + strict rate limit (5/15 min) |
| `GET /integrations/gmail/connect` had `requireAuth` commented out — attacker could link any userId to their Gmail | `requireAuth` restored; userId derived from verified JWT |
| `userId` accepted as unauthenticated query parameter | Removed; userId only comes from `req.user` (set by JWT middleware) |
| In-memory rate limiter — broken at >1 web node, resets on restart | Replaced with Redis-backed `RateLimiterRedis` with `RateLimiterMemory` failover |
| No HTTP security headers (no helmet) | `helmet()` applied globally with strict CSP, HSTS in production, X-Powered-By removed |
| No CORS policy | `cors()` applied; respects `ALLOWED_ORIGINS` env var; strict deny-all in production when unset |
| No body-size limit on `express.json()` | `express.json({ limit: '1mb' })` applied globally |
| `JWT_SECRET` not validated at startup | `validateSecrets()` enforces minimum 32 chars at module load |
| `ENCRYPTION_KEY` all-zeros placeholder in `.env.example` | Blocked in production via `validateSecrets()` |
| Sensitive keys missing from log redaction | Added `password`, `secret`, `authorization`, `cookie`, `encryptionKey`, `apiKey`, `internalApiKey`, `jwtSecret`, `refreshTokenEncrypted`, `accessTokenEncrypted`, `stack` |
| Floating `startAllWorkers()` call — crash was silent | Wrapped in try/catch with `process.exit(1)` |
| `console.info` in `index.ts` — bypassed logger redaction | Replaced with `logger.info` |
| SIGINT not handled in web server | Added alongside SIGTERM in `gracefulShutdown()` |
| Unhandled rejections could crash process silently | `process.on('unhandledRejection')` logs and continues |
| Uncaught exceptions crashed without logging | `process.on('uncaughtException')` logs then exits cleanly |
| Stale security test — asserted old mock-auth behavior | Rewritten to test real JWT rejection + rate limiter |

---

## Remaining Risks

### Medium

| Risk | Reason Not Fixed Here | Recommendation |
|---|---|---|
| `OAuthStateService` is in-memory — breaks horizontal scaling | Out of scope for security hardening; requires Redis-backed state store | Epic 0.6 — migrate to `RedisCacheService` |
| Rate limiter on non-auth routes uses per-IP keying only — no per-user keying after auth | Sufficient for current scale; per-user keying requires auth context before rate check | Epic 0.6 — add `req.user?.id` as secondary key post-auth |
| `compress()` enabled without `Vary: Accept-Encoding` guarantee | Helmet's `noSniff` mitigates sniffing; `compression` package sets Vary correctly | Monitor |
| `POST /auth/token` is still HTTP-reachable by any caller who knows `INTERNAL_API_KEY` | Key must be treated as a production secret; rotate if compromised | Store in Vault / AWS Secrets Manager |

### Low

| Risk | Notes |
|---|---|
| MIME type on resume uploads is client-supplied (multer reads Content-Type) | Extension + MIME whitelist is in place; magic-byte validation (file-type package) would add defense-in-depth |
| Stack traces in `logger.error` context are now redacted (`'stack'` in SENSITIVE_KEYS) | This is intentional — stack traces in structured log context can expose file paths. The message string is unaffected. |
| `ALLOWED_ORIGINS` defaults to allow-all in development | Expected dev behavior; production requires explicit configuration |

### Deferred

| Item | Reason |
|---|---|
| Docker / container security | Epic 0.2 |
| CI/CD secret scanning | Epic 0.3 |
| Structured JSON logging (pino/winston) | Epic 0.4 |
| Prometheus metrics | Epic 0.5 |
| DB migration baseline | Epic 0.7 |

---

## Technical Debt

1. **10 pre-existing test failures** — all in route and tracking tests; caused by pagination arg mismatch (`{page: undefined, pageSize: undefined}` passed where tests don't expect it) and `dbRouter` not being mocked in `application-tracking.test.ts`. These predate Epic 0.1 and are not regressions.

2. **ESLint rules are too permissive** — `no-floating-promises`, `no-unsafe-assignment`, etc. are all disabled in `.eslintrc.json`. Re-enabling them would surface real async bugs. Recommended for Epic 0.3 alongside CI.

3. **`src/lib/cache.ts` (InMemoryCacheStore)** — still used by `DashboardService`. Should migrate to `ICacheService` (Epic 0.6) for cache consistency across instances.

4. **Legacy DB-polling workers** (`src/workers/gmail-sync.worker.ts`, `src/workers/job-queue.service.ts`) — superseded by BullMQ workers but still present. Decommission in Epic 0.6.

---

## Suggested Epic 0.2 Prerequisites

Before starting Epic 0.2 (Docker & Local Dev Environment):

1. **Set `ALLOWED_ORIGINS`** in your `.env` for local dev to avoid CORS errors when running the frontend.
2. **Generate real secrets** for local dev:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # INTERNAL_API_KEY
   ```
3. **Baseline Prisma migration** — `prisma/migrations/0_init/migration.sql` must be created before Docker compose brings up a fresh Postgres instance. Without it, `prisma migrate deploy` will only apply the resume dedup migration and skip the core schema.
4. **Redis in docker-compose** — the rate limiter and token cache both require Redis. The compose file must include a Redis service that starts before the API container.
5. **Resolve the 10 pre-existing test failures** so the CI pipeline starts green, not already-failing.
