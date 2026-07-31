-- ============================================================
-- Career Terminal — Database Role Separation & RLS Functions
-- ============================================================
--
-- This migration ensures the least-privilege PostgreSQL group roles exist
-- and that every table the application creates is accessible to those roles.
--
-- Role model (NOLOGIN group roles):
--   app_runtime   — normal API query + DML (no DDL)
--   app_worker    — same as runtime but for background workers
--   app_migration — schema changes, migrations (DDL)
--   app_readonly  — read-only reporting
--   app_admin     — elevated operations (outbox/ops); never used by app pods
--
-- Login users are NOT created here. They require CREATEROLE and are
-- provisioned out-of-band by an ops-run bootstrap:
--   - docker dev: docker/postgres/init/01-create-app-roles.sh
--   - production: scripts/db/bootstrap-roles.sql (run with a superuser/ops
--     connection before the first `prisma migrate deploy`)
--
-- Production credential separation:
--   api/worker pods connect with dedicated login users
--     (career_terminal_runtime / career_terminal_worker). They are members of
--     exactly one DML group role, so SET ROLE into another role is impossible.
--   migrations run as career_terminal_migr (app_migration) with DATABASE_URL
--     set to the migration URL — never the app URL, never the superuser.
--
-- RLS GUC functions:
--   set_app_user_id          — transaction-scoped (safe under PgBouncer
--                              transaction pooling; fails closed otherwise)
--   set_app_user_id_session  — session-scoped (direct connections only; the
--                              Prisma interceptor must reset it per request)
--   current_app_user_id      — reads the GUC, returns UUID or NULL
--
-- Connection URLs (production):
--   api:      postgresql://career_terminal_runtime:<pwd>@host/db?options=-c+role%3Dapp_runtime
--   worker:   postgresql://career_terminal_worker:<pwd>@host/db?options=-c+role%3Dapp_worker
--   migration: postgresql://career_terminal_migr:<pwd>@host/db
-- ============================================================

-- ── 1. Ensure group roles exist ─────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END
$$;

-- ── 2. Revoke default public privileges (defense in depth) ──

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

-- ── 3. Grant schema usage to app roles (required for queries) ──

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_migration;
GRANT USAGE ON SCHEMA public TO app_admin;

-- ── 4. Grant table/sequence privileges ────────────────────────

-- Runtime + Worker: full DML on all tables, usage on sequences, NO DDL
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_worker;

-- Migration: full DDL + DML
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_migration;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_migration;
GRANT CREATE ON SCHEMA public TO app_migration;

-- Readonly: SELECT only
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

-- Admin: full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_admin;
GRANT ALL ON SCHEMA public TO app_admin;

-- ── 5. Default privileges for future tables ───────────────────
-- Applies to tables/sequences created by the migration role so that
-- every future table is automatically accessible to runtime + worker.

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_worker;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_migration;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_migration;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_admin;

-- ── 6. Ensure runtime/worker cannot execute DDL ───────────────

REVOKE CREATE ON SCHEMA public FROM app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_worker;
REVOKE CREATE ON SCHEMA public FROM app_readonly;

-- ── 7. RLS GUC helper functions ───────────────────────────────

-- Transaction-scoped. Visible only within the current transaction.
-- This is the production-safe primitive (see header comment).
CREATE OR REPLACE FUNCTION set_app_user_id(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Session-scoped. Used only by the Prisma interceptor on direct (non-pooled)
-- connections. Under PgBouncer transaction pooling it is reset between pooled
-- transactions (DISCARD ALL) so it fails closed rather than leaking.
CREATE OR REPLACE FUNCTION set_app_user_id_session(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── 8. Verify ─────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin');
END
$$;
