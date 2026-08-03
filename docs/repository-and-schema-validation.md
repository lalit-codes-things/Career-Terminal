# Repository and Prisma Schema Validation

## Repository architecture

Application and business services depend on feature-specific repository ports, not on `PrismaClient`. Repository interfaces expose domain-shaped methods for persistence, transactions, cursor pagination, bulk upserts, idempotent writes, and optimistic locking without leaking Prisma model delegates. Prisma usage belongs in concrete repository implementations under `repositories/`.

The recruiter-intelligence repository keeps the write contract intentionally specific rather than introducing a generic repository abstraction. This keeps the interface compatible with future CQRS/read-replica work: command methods remain on write repositories, while future query repositories can be added as separate read ports backed by replicas or projections.

## Dependency rules

- Business/application services import repository interfaces only.
- Prisma Client may be imported by repository implementations, infrastructure wiring, migrations, and tests.
- Transactions are exposed as opaque repository transaction contexts so service code cannot couple itself to Prisma transaction clients.
- Optimistic updates pass an `expectedUpdatedAt` value and fail if no row matches.
- Cursor pagination uses stable `id` cursors with a deterministic order.

## Migration and schema validation workflow

Use these scripts in local development, CI, and production images:

```bash
npm run db:generate       # generate Prisma Client
npm run db:schema:check   # validate prisma/schema.prisma
npm run db:migrate:check  # validate migrations; live checks run when DATABASE_URL exists
npm run db:check          # full schema/client/startup validation bundle
```

`db:migrate:check` always validates schema syntax. If `DATABASE_URL` is absent, live database checks are skipped gracefully for fresh clones and offline CI jobs. If `DATABASE_URL` is present, it runs Prisma migration status and drift validation. If `SHADOW_DATABASE_URL` is also present, schema drift is checked against migrations with `prisma migrate diff`.

## Local development

1. Install dependencies with `npm ci`.
2. Generate the Prisma Client with `npm run db:generate`.
3. Start PostgreSQL or provide `DATABASE_URL` if live migration validation is desired.
4. Run `npm run db:check` before opening a pull request.

## CI workflow

CI installs dependencies, generates Prisma Client, runs `npm run db:check`, typechecks, tests, and builds. Without a CI database, live migration validation is skipped but schema syntax and generated-client loading still run.

## Production deployment

Run migrations as a single pre-deployment job with `npm run db:migrate:deploy`. The application startup validation then verifies schema/client synchronization and migration state before reporting readiness. A failed validation prevents the service from accepting traffic.
