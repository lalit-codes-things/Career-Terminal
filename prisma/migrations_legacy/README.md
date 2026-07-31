# Legacy Migrations (Archived)

This directory is a **read-only archive** of the previous Prisma migration
chain. It is NOT applied by `prisma migrate deploy` — Prisma only scans
`prisma/migrations/`.

## Why it was archived

The previous 18-migration chain had drifted from `prisma/schema.prisma` and
could never be applied to a fresh database:

- `0_init` created only 13 tables while `schema.prisma` declared 64 models;
  tables such as `gmail_sync_states`, `gmail_checkpoints`, `sync_operations`,
  `predictions`, and `email_attachments` were never created by any migration.
- Table names drifted (`"GmailSyncState"` vs `gmail_sync_states`,
  `"application_timeline"` vs `application_timeline_events`).
- The chain failed at migration #3
  (`20260725000001_add_user_identity`: `relation "gmail_sync_state" does not
  exist`), confirmed by replaying the SQL manually.

It was replaced by a single consolidated baseline generated from the current
schema:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

The active chain is now:

1. `0_init`                          — full schema baseline (64 tables + enums).
2. `20260731000001_add_database_roles` — least-privilege roles, grants, RLS GUC
   functions.
3. `20260731000002_enable_rls`       — ROW LEVEL SECURITY policies.
4. `20260731000003_add_pgvector_search` — HNSW / trigram / GIN / composite
   indexes and the embedding-model seed.

Any data migration needed for pre-existing rows must be written as an ops-run
script (not a Prisma migration) against the new baseline.
