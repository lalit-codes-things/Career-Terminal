# Recruiter Intelligence Service Skeleton

This directory contains the architectural foundation for Epic 6 and the Batch 1 remediation work.

## Repository architecture

- Repositories should implement domain-oriented interfaces rather than leaking Prisma into application services.
- Business logic should depend on repository contracts, not the generated Prisma client directly.
- Transactional and bulk operations are supported through the shared base repository wrapper.

## Migration workflow

1. Run `npm run db:generate` after schema changes.
2. Run `npx prisma migrate dev --name <name>` to create a migration.
3. Run `npm run db:validate-migrations` when DATABASE_URL is available.
4. Run `npm run db:verify` during startup or CI to ensure schema, migrations, and generated client remain synchronized.

## Local development

- Set `DATABASE_URL` to a local PostgreSQL instance before running migration validation.
- If `DATABASE_URL` is absent, validation will skip gracefully.

## CI workflow

- Run `npm run db:generate`.
- Run `npm run db:verify`.
- Run `npm test -- --runInBand src/services/recruiter-intelligence/__tests__`.

## Production deployment

- Validate migrations before deployment.
- Ensure the generated Prisma client is committed or regenerated in the release build.
- Run startup validation during boot so schema drift is detected early.
