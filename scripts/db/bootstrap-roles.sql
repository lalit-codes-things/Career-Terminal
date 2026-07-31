-- =============================================================================
-- Career Terminal — Production Role Bootstrap (ops-run)
-- =============================================================================
--
-- Run this with a SUPERUSER connection (or a role with CREATEROLE + ownership
-- of the application database) BEFORE the first `prisma migrate deploy`.
--
--   psql "$OPS_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db/bootstrap-roles.sql
--
-- It is intentionally NOT part of the Prisma migration set: login roles and
-- extensions require privileges the migration role (app_migration) does not
-- hold, and provisioning them from migrations would violate least privilege.
--
-- Password variables are supplied via psql variables:
--   -v app_runtime_password=...  -v app_worker_password=...
--   -v migration_password=...    -v admin_password=...
--
-- After this runs, the app never needs the superuser again.
-- =============================================================================

-- ── 1. Extensions (require superuser / database-owner) ──────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 2. Group roles ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END
$$;

-- ── 3. Login users (one per role — see migration header) ────────────────────
-- Passwords come from psql -v variables. \gexec is required: psql does NOT
-- interpolate variables inside DO $$ ... $$ blocks, so we generate the DDL
-- with format()/%L and execute it only when the role does not exist yet.

SELECT format('CREATE ROLE career_terminal_runtime LOGIN PASSWORD %L', :'app_runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_runtime')\gexec

SELECT format('CREATE ROLE career_terminal_worker LOGIN PASSWORD %L', :'app_worker_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_worker')\gexec

SELECT format('CREATE ROLE career_terminal_migr LOGIN PASSWORD %L', :'migration_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_migr')\gexec

SELECT format('CREATE ROLE career_terminal_admin LOGIN PASSWORD %L', :'admin_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_admin')\gexec

GRANT app_runtime   TO career_terminal_runtime;
GRANT app_readonly  TO career_terminal_runtime;
GRANT app_worker    TO career_terminal_worker;
GRANT app_migration TO career_terminal_migr;
GRANT app_admin     TO career_terminal_admin;

-- ── 4. Revoke public privileges ─────────────────────────────────────────────
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ── 5. Schema usage ─────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT USAGE ON SCHEMA public TO app_migration;
GRANT USAGE ON SCHEMA public TO app_admin;

-- ── 6. Table / sequence privileges ──────────────────────────────────────────
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

-- ── 7. Default privileges for future tables ─────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE career_terminal_migr IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE career_terminal_migr IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE career_terminal_migr IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE career_terminal_migr IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE career_terminal_migr IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;

-- ── 8. No DDL for runtime/worker/readonly ───────────────────────────────────
REVOKE CREATE ON SCHEMA public FROM app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_worker;
REVOKE CREATE ON SCHEMA public FROM app_readonly;

-- ── 9. RLS GUC functions ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_app_user_id(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

-- ── 10. Verify ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_runtime');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_worker');
  ASSERT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'career_terminal_migr');
END
$$;
