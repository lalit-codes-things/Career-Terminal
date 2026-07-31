-- Career Terminal — PostgreSQL App Role Initialization
-- This script runs as the POSTGRES_USER (superuser) during container initialization.
-- It creates the least-privilege application roles used by the api and worker processes.

-- ── 1. Create roles ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD :app_password;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker WITH LOGIN PASSWORD :app_password;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly WITH LOGIN PASSWORD :app_password;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration WITH LOGIN PASSWORD :migration_password;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin WITH LOGIN PASSWORD :admin_password;
  END IF;
END
$$;

-- ── 2. Revoke public privileges ─────────────────────────────────────────────────

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :app_db FROM PUBLIC;

-- ── 3. Grant schema usage ───────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_migration;
GRANT USAGE ON SCHEMA public TO app_admin;

-- ── 4. Grant table/sequence privileges ──────────────────────────────────────────

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

-- ── 5. Default privileges for future tables ─────────────────────────────────────

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

-- ── 6. Prevent runtime/worker from executing DDL ────────────────────────────────

REVOKE CREATE ON SCHEMA public FROM app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_worker;
REVOKE CREATE ON SCHEMA public FROM app_readonly;

-- ── 7. Create RLS helper functions ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_app_user_id(p_user_id TEXT)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 8. Verify roles exist ───────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin');
END
$$;