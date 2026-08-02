#!/bin/sh
# =============================================================================
# Career Terminal — Integration Test Database Bootstrap
# =============================================================================
#
# Creates a fresh `career_terminal_test_<timestamp>` database, provisions
# roles/users exactly like production (scripts/db/bootstrap-roles.sql), then
# applies every Prisma migration. Run against a LOCAL PostgreSQL superuser
# before executing the integration test suite:
#
#   sudo -u postgres scripts/db/test-bootstrap.sh
#
# A timestamped database name is used so re-runs never need to DROP an
# existing database (no destructive operations). Override with TEST_DB for
# a stable name (must not already exist).
#
# The superuser connection is used ONLY to create roles/users/extension and to
# run migrations. Runtime tests connect with the dedicated role users, proving
# the production credential split works.
#
# Connection building:
#   PG_CONN_HOST_OPTS - libpq connection options (no db name), e.g.
#                       ?host=/var/run/postgresql  (unix socket)
#                       :5432                       (TCP localhost)
#   PG_SUPERUSER_URL  - full maintenance-db URL. Prisma requires a real host
#                       (socket URLs are not supported), so for migrations set
#                       this to a TCP URL, e.g.
#                       postgresql://postgres:<pwd>@localhost:5432/postgres
# =============================================================================
set -e

PG_SUPERUSER_URL="${PG_SUPERUSER_URL:-postgresql://postgres:local-superuser-test-pass@localhost:5432/postgres}"
PG_MAINT_URL="${PG_SUPERUSER_URL}"
STAMP="$(date +%s)"
TEST_DB="${TEST_DB:-career_terminal_test_${STAMP}}"

RUNTIME_USER="${DATABASE_RUNTIME_USER:-career_terminal_runtime}"
RUNTIME_PASSWORD="${DATABASE_RUNTIME_PASSWORD:-test-runtime-pass-123}"
WORKER_USER="${DATABASE_WORKER_USER:-career_terminal_worker}"
WORKER_PASSWORD="${DATABASE_WORKER_PASSWORD:-test-worker-pass-123}"
MIGRATION_USER="${DATABASE_MIGRATION_USER:-career_terminal_migr}"
MIGRATION_PASSWORD="${DATABASE_MIGRATION_PASSWORD:-test-migration-pass-123}"

# Roles/users are cluster-wide; provision them (idempotent) on the
# maintenance database.
psql "$PG_MAINT_URL" -v ON_ERROR_STOP=1 -v app_runtime_password="$RUNTIME_PASSWORD" -v app_worker_password="$WORKER_PASSWORD" -v migration_password="$MIGRATION_PASSWORD" -v admin_password="test-admin-pass-123" -f scripts/db/bootstrap-roles.sql

# Derive the test DB URL from the maintenance URL by swapping the dbname
# (keeps credentials/host identical).
TEST_DB_URL="${PG_SUPERUSER_URL%/*}/${TEST_DB}"

psql "$PG_SUPERUSER_URL" -v ON_ERROR_STOP=1 -v dbname="$TEST_DB" <<-EOSQL
  SELECT format('CREATE DATABASE %I', :'dbname')\gexec
EOSQL
psql "$PG_SUPERUSER_URL" -v ON_ERROR_STOP=1 -v dbname="$TEST_DB" -v owner="$MIGRATION_USER" <<-EOSQL
  SELECT format('GRANT ALL ON DATABASE %I TO %I', :'dbname', :'owner')\gexec
EOSQL

# Extensions require a superuser (vector is untrusted). In production this is
# docker/postgres/init/00-extensions.sql or an ops-run step before migrations.
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS btree_gin;
EOSQL

# Prisma uses the superuser URL for the migration run so that DDL succeeds;
# production runs migrations as career_terminal_migr via DATABASE_MIGRATION_URL.
export DATABASE_URL="$TEST_DB_URL"
npx prisma migrate deploy

echo "test-bootstrap: ready."
echo "  TEST_DATABASE_URL=$TEST_DB_URL"
echo "  TEST_RUNTIME_URL=postgresql://${RUNTIME_USER}:${RUNTIME_PASSWORD}@localhost:5432/${TEST_DB}?options=-c%20role%3Dapp_runtime"
echo "  TEST_WORKER_URL=postgresql://${WORKER_USER}:${WORKER_PASSWORD}@localhost:5432/${TEST_DB}?options=-c%20role%3Dapp_worker"
echo "  TEST_MIGRATION_URL=postgresql://${MIGRATION_USER}:${MIGRATION_PASSWORD}@localhost:5432/${TEST_DB}"
