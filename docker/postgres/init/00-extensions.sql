-- Career Terminal — PostgreSQL Extension Bootstrap
-- Runs as the container superuser (POSTGRES_USER) during initialization.
--
-- Some extensions (e.g. pgvector) are NOT "trusted": they require superuser
-- or a role with explicit CREATE on the database to install. They must be
-- provisioned here (or by an ops-run bootstrap in production) BEFORE the
-- app_migration role runs `prisma migrate deploy`. The migration SQL that
-- references them relies on this provisioning, so do not remove them.

-- pgvector provides the `vector` type + HNSW indexes for semantic search.
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto provides gen_random_uuid() used by several tables.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_trgm provides trigram indexes for name/industry/title search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- btree_gin enables GIN indexes over scalar columns (used with pg_trgm).
CREATE EXTENSION IF NOT EXISTS btree_gin;
