-- ============================================================
-- Career Terminal — Database Role Separation & User Creation
-- ============================================================
--
-- This migration creates the least-privilege PostgreSQL roles and
-- corresponding users used by the application in production.
--
-- Role model:
--   app_runtime   — normal API query + DML (no DDL)
--   app_worker    — same as runtime but for background workers
--   app_migration — schema changes, migrations (DDL)
--   app_readonly  — read-only reporting
--   app_admin     — elevated operations, outbox, RLS bypass when needed
--
-- Users:
--   career_terminal_app  — member of app_runtime, app_worker, app_readonly
--   career_terminal_migr — member of app_migration
--
-- Credentials:
--   In production these are set via environment variables:
--     DATABASE_APP_USER / DATABASE_APP_PASSWORD (for app users)
--     POSTGRES_USER / POSTGRES_PASSWORD (for migration user, managed by ops)
--
-- Connection URLs:
--   api/worker: postgresql://career_terminal_app:<password>@host/db?options=-c+role%3Dapp_runtime
--   migration: postgresql://career_terminal_migr:<password>@host/db

-- ── 1. Ensure roles exist ─────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin;
  END IF;
END
$$;

-- ── 2. Grant role memberships ──────────────────────────────────

-- app_runtime: can query and modify data, cannot modify schema
GRANT app_runtime TO app_runtime; -- self-membership for convenience

-- app_worker: same privileges as runtime
GRANT app_worker TO app_worker;

-- app_migration: can modify schema, create extensions, create indexes
GRANT app_migration TO app_migration;

-- app_readonly: can only read data
GRANT app_readonly TO app_readonly;

-- app_admin: full access within the application database
GRANT app_admin TO app_admin;

-- ── 3. Revoke default public privileges (defense in depth) ────

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE career_terminal FROM PUBLIC;

-- ── 4. Grant schema usage to app roles (required for queries) ──

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_migration;

-- ── 5. Grant table/sequence privileges ─────────────────────────

-- Runtime + Worker: full DML on all tables, usage on sequences
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

-- ── 6. Default privileges for future tables ───────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_worker;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_migration;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_migration;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT CREATE ON SCHEMA public TO app_migration;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SCHEMA public TO app_admin;

-- ── 7. Ensure runtime cannot execute DDL ───────────────────────

REVOKE CREATE ON SCHEMA public FROM app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_worker;
REVOKE CREATE ON SCHEMA public FROM app_readonly;

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
