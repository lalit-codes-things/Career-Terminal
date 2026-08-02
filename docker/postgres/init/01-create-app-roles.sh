#!/bin/sh
# =============================================================================
# Career Terminal — PostgreSQL App Role Bootstrap (docker init)
# =============================================================================
#
# Runs as the container superuser (POSTGRES_USER) during postgres container
# initialization. It creates the least-privilege application roles and users
# that the api and worker processes use in production.
#
# Role model (NOLOGIN group roles):
#   app_runtime    — API runtime: SELECT/INSERT/UPDATE/DELETE, NO DDL
#   app_worker     — background workers: SELECT/INSERT/UPDATE/DELETE, NO DDL
#   app_readonly   — read-only reporting
#   app_migration  — schema migrations (DDL, extensions already provisioned)
#   app_admin      — elevated operations (outbox/ops); never used by app pods
#
# Login users (one per role so connection pools never share roles):
#   ${DATABASE_RUNTIME_USER}   — member of app_runtime, app_readonly
#   ${DATABASE_WORKER_USER}    — member of app_worker
#   ${DATABASE_MIGRATION_USER} — member of app_migration
#   ${DATABASE_ADMIN_USER}     — member of app_admin
#   ${DATABASE_READONLY_USER}  — member of app_readonly
#
# The Dockerfile/postgres service is the ONLY consumer of the superuser
# credential (POSTGRES_USER). No application connection string may use it.
# Passwords are supplied via environment and must not contain single quotes.
# =============================================================================

set -e

if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
  echo "bootstrap-roles: POSTGRES_USER/POSTGRES_DB are required" >&2
  exit 1
fi

RUNTIME_USER="${DATABASE_RUNTIME_USER:-career_terminal_runtime}"
WORKER_USER="${DATABASE_WORKER_USER:-career_terminal_worker}"
MIGRATION_USER="${DATABASE_MIGRATION_USER:-career_terminal_migr}"
ADMIN_USER="${DATABASE_ADMIN_USER:-career_terminal_admin}"
READONLY_USER="${DATABASE_READONLY_USER:-career_terminal_readonly}"

RUNTIME_PASSWORD="${DATABASE_RUNTIME_PASSWORD:-${DATABASE_APP_PASSWORD:-}}"
WORKER_PASSWORD="${DATABASE_WORKER_PASSWORD:-${DATABASE_APP_PASSWORD:-}}"
MIGRATION_PASSWORD="${DATABASE_MIGRATION_PASSWORD:-${POSTGRES_PASSWORD:-}}"
ADMIN_PASSWORD="${DATABASE_ADMIN_PASSWORD:-${POSTGRES_PASSWORD:-}}"
READONLY_PASSWORD="${DATABASE_READONLY_PASSWORD:-${DATABASE_APP_PASSWORD:-}}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

-- ── 1. Group roles (NOLOGIN) ─────────────────────────────────────────────
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly NOLOGIN;
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration NOLOGIN;
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END
\$\$;

-- ── 2. Login users (distinct users per role) ─────────────────────────────
-- A user that is a member of exactly one group role cannot SET ROLE into
-- another, so a leaked runtime credential cannot act as the worker/admin.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${RUNTIME_USER}') THEN
    CREATE ROLE "${RUNTIME_USER}" LOGIN PASSWORD '${RUNTIME_PASSWORD}';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${WORKER_USER}') THEN
    CREATE ROLE "${WORKER_USER}" LOGIN PASSWORD '${WORKER_PASSWORD}';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${MIGRATION_USER}') THEN
    CREATE ROLE "${MIGRATION_USER}" LOGIN PASSWORD '${MIGRATION_PASSWORD}';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${ADMIN_USER}') THEN
    CREATE ROLE "${ADMIN_USER}" LOGIN PASSWORD '${ADMIN_PASSWORD}';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${READONLY_USER}') THEN
    CREATE ROLE "${READONLY_USER}" LOGIN PASSWORD '${READONLY_PASSWORD}';
  END IF;
END
\$\$;

-- ── 3. Role memberships ──────────────────────────────────────────────────
GRANT app_runtime   TO "${RUNTIME_USER}";
GRANT app_readonly  TO "${RUNTIME_USER}";
GRANT app_worker    TO "${WORKER_USER}";
GRANT app_migration TO "${MIGRATION_USER}";
GRANT app_admin     TO "${ADMIN_USER}";
GRANT app_readonly  TO "${READONLY_USER}";

-- ── 4. Revoke public privileges (defense in depth) ───────────────────────
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO \$\$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
\$\$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ── 5. Schema usage ──────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_migration;
GRANT USAGE ON SCHEMA public TO app_admin;

-- ── 6. Table / sequence privileges ───────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_worker;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

GRANT ALL ON ALL TABLES IN SCHEMA public TO app_migration;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_migration;
GRANT CREATE ON SCHEMA public TO app_migration;

GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_admin;
GRANT ALL ON SCHEMA public TO app_admin;

-- ── 7. Default privileges ────────────────────────────────────────────────
-- Future tables created by the migration role must automatically be
-- readable/writable by runtime + worker roles.
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATION_USER}" IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;

-- ── 8. No DDL for runtime/worker/readonly ────────────────────────────────
REVOKE CREATE ON SCHEMA public FROM app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_worker;
REVOKE CREATE ON SCHEMA public FROM app_readonly;

-- ── 9. RLS helper functions ──────────────────────────────────────────────
-- set_app_user_id: transaction-scoped. The value is visible only within the
--   current transaction. This is the ONLY safe primitive under PgBouncer
--   transaction pooling (DISCARD ALL resets session state between pooled
--   transactions, so a stale value can never leak to another tenant).
CREATE OR REPLACE FUNCTION set_app_user_id(p_user_id TEXT)
RETURNS VOID AS \$\$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, true);
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_app_user_id_session: session-scoped. Used ONLY for direct (non-pooled)
--   connections by the Prisma query interceptor for convenience. Under
--   PgBouncer transaction pooling this value is discarded between pooled
--   transactions, which fails CLOSED (no cross-tenant leakage).
CREATE OR REPLACE FUNCTION set_app_user_id_session(p_user_id TEXT)
RETURNS VOID AS \$\$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, false);
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID AS \$\$
BEGIN
  RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
\$\$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── 10. Verify bootstrap ─────────────────────────────────────────────────
DO \$\$
BEGIN
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${RUNTIME_USER}');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${WORKER_USER}');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${MIGRATION_USER}');
END
\$\$;
EOSQL

echo "bootstrap-roles: roles and users provisioned."
