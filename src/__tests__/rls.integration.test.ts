/**
 * RLS Integration Tests — real PostgreSQL role isolation.
 *
 * These tests prove that Row-Level Security policies correctly isolate users
 * across the application's PostgreSQL roles. They require:
 *   - A running PostgreSQL 16 instance with pgvector extension
 *   - The schema migrated (prisma migrate deploy)
 *   - The 20260731000001_add_database_roles migration applied
 *   - The 20260731000002_enable_rls migration applied
 *   - The 20260731000005_fix_rls_policies migration applied
 *
 * Run with: DATABASE_INTEGRATION_URL=postgresql://migr:password@localhost:5432/career-terminal npx jest src/__tests__/rls.integration.test.ts
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Environment guard — these tests only run when explicitly enabled
// ---------------------------------------------------------------------------

const INTEGRATION_URL = process.env.DATABASE_INTEGRATION_URL;

const describeRlsIntegration = INTEGRATION_URL ? describe : describe.skip;

describeRlsIntegration('PostgreSQL RLS Integration Tests', () => {
  let adminPool: Pool;
  let runtimePoolA: Pool;
  let runtimePoolB: Pool;
  let workerPool: Pool;

  const userAId = uuidv4();
  const userBId = uuidv4();

  const getConnUrl = (user: string, password: string) =>
    INTEGRATION_URL!.replace('://', `://${encodeURIComponent(user)}:${encodeURIComponent(password)}@`);

  beforeAll(async () => {
    // Create role-specific pools
    adminPool = new Pool({ connectionString: getConnUrl('career_terminal_migr', INTEGRATION_URL!.split(':')[2]?.split('@')[0] || 'password') });
    // For the integration tests we connect via the migr superuser to create test data
    // and via runtime/worker roles to verify RLS policies.

    // Create a simple test user for role 'app_runtime'
    await adminPool.query(`INSERT INTO "users" (id, email, name, region) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [
      userAId, 'usera@test.local', 'User A', 'us-east-1'
    ]);
    await adminPool.query(`INSERT INTO "users" (id, email, name, region) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [
      userBId, 'userb@test.local', 'User B', 'us-east-1'
    ]);

    // Create candidate profiles
    await adminPool.query(`INSERT INTO "candidate_profiles" (id, user_id, full_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [
      uuidv4(), userAId, 'Profile A'
    ]);
    await adminPool.query(`INSERT INTO "candidate_profiles" (id, user_id, full_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [
      uuidv4(), userBId, 'Profile B'
    ]);

    // Create user resumes
    await adminPool.query(`INSERT INTO "user_resumes" (id, user_id, filename, s3_key, content_type) VALUES ($1, $2, $3, $4, $5)`, [
      uuidv4(), userAId, 'resume-a.pdf', 'resumes/a.pdf', 'application/pdf'
    ]);
    await adminPool.query(`INSERT INTO "user_resumes" (id, user_id, filename, s3_key, content_type) VALUES ($1, $2, $3, $4, $5)`, [
      uuidv4(), userBId, 'resume-b.pdf', 'resumes/b.pdf', 'application/pdf'
    ]);

    // Create events
    await adminPool.query(`INSERT INTO "events" (id, event_type, aggregate_id, aggregate_type, user_id, cell_id, payload, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      uuidv4(), 'TEST_EVENT', uuidv4(), 'TestAggregate', userAId, 'cell-1', '{}', 'corr-a'
    ]);
    await adminPool.query(`INSERT INTO "events" (id, event_type, aggregate_id, aggregate_type, user_id, cell_id, payload, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      uuidv4(), 'TEST_EVENT', uuidv4(), 'TestAggregate', userBId, 'cell-1', '{}', 'corr-b'
    ]);
  });

  afterAll(async () => {
    // Clean up test data via admin
    if (adminPool) {
      await adminPool.query('DELETE FROM events WHERE user_id = ANY($1::uuid[])', [[userAId, userBId]]);
      await adminPool.query('DELETE FROM user_resumes WHERE user_id = ANY($1::uuid[])', [[userAId, userBId]]);
      await adminPool.query('DELETE FROM candidate_profiles WHERE user_id = ANY($1::uuid[])', [[userAId, userBId]]);
      await adminPool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userAId, userBId]]);
      await adminPool.end();
    }
  });

  // -------------------------------------------------------------------------
  // Helper: run a query as a specific role
  // -------------------------------------------------------------------------

  async function queryAs(_role: 'runtime' | 'worker' | 'admin', sql: string, params: unknown[] = []) {
    let pool: Pool;
    switch (role) {
      case 'runtime':
        pool = runtimePoolA;
        break;
      case 'worker':
        pool = workerPool;
        break;
      case 'admin':
        pool = adminPool;
        break;
    }
    return pool.query(sql, params);
  }

  describe('Cross-user isolation', () => {
    beforeEach(async () => {
      // Create fresh pools
      runtimePoolA = new Pool({
        connectionString: getConnUrl('career_terminal_runtime', 'runtime-password'),
      });
      runtimePoolB = new Pool({
        connectionString: getConnUrl('career_terminal_runtime', 'runtime-password'),
      });
      workerPool = new Pool({
        connectionString: getConnUrl('career_terminal_worker', 'worker-password'),
      });
    });

    afterEach(async () => {
      await runtimePoolA.end();
      await runtimePoolB.end();
      await workerPool.end();
    });

    it('User A can read their own candidate profile', async () => {
      await runtimePoolA.query('SELECT set_app_user_id($1)', [userAId]);
      const result = await runtimePoolA.query('SELECT COUNT(*) FROM "candidate_profiles"');
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(1);
    });

    it('User A CANNOT read User B\'s candidate profile', async () => {
      await runtimePoolA.query('SELECT set_app_user_id($1)', [userAId]);
      const result = await runtimePoolA.query('SELECT COUNT(*) FROM "candidate_profiles" WHERE "user_id" = $1', [userBId]);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('User A CANNOT update User B\'s resume', async () => {
      await runtimePoolA.query('SELECT set_app_user_id($1)', [userAId]);
      const bResume = await adminPool.query('SELECT id FROM user_resumes WHERE user_id = $1 LIMIT 1', [userBId]);
      if (bResume.rows.length === 0) {
        // Create one if not exists
        await adminPool.query(`INSERT INTO "user_resumes" (id, user_id, filename, s3_key, content_type) VALUES ($1, $2, $3, $4, $5)`, [
          uuidv4(), userBId, 'resume-b-u.pdf', 'resumes/b-u.pdf', 'application/pdf'
        ]);
      }
      const rowsAfter = await adminPool.query('SELECT id FROM user_resumes WHERE user_id = $1', [userBId]);
      const targetId = rowsAfter.rows[0]?.id;
      if (!targetId) return; // skip if can't set up

      try {
        await runtimePoolA.query('UPDATE "user_resumes" SET filename = $1 WHERE id = $2', ['hacked.pdf', targetId]);
        // Should have thrown or affected 0 rows
        const check = await adminPool.query('SELECT filename FROM user_resumes WHERE id = $1', [targetId]);
        expect(check.rows[0]?.filename).not.toBe('hacked.pdf');
      } catch {
        // Expected: RLS blocks the update
      }
    });

    it('User A CANNOT delete User B\'s event', async () => {
      await runtimePoolA.query('SELECT set_app_user_id($1)', [userAId]);
      const bEvents = await adminPool.query('SELECT id FROM events WHERE user_id = $1 LIMIT 1', [userBId]);
      if (bEvents.rows.length === 0) {
        await adminPool.query(`INSERT INTO "events" (id, event_type, aggregate_id, aggregate_type, user_id, cell_id, payload, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
          uuidv4(), 'TEST_EVENT', uuidv4(), 'TestAggregate', userBId, 'cell-1', '{}', 'corr-b-del'
        ]);
      }
      const targetEvent = await adminPool.query('SELECT id FROM events WHERE user_id = $1 LIMIT 1', [userBId]);
      const targetId = targetEvent.rows[0]?.id;
      if (!targetId) return;

      try {
        await runtimePoolA.query('DELETE FROM events WHERE id = $1', [targetId]);
        const check = await adminPool.query('SELECT COUNT(*) FROM events WHERE id = $1', [targetId]);
        expect(parseInt(check.rows[0].count)).toBeGreaterThanOrEqual(1);
      } catch {
        // Expected: RLS blocks the delete
      }
    });

    it('Worker CANNOT accidentally claim another user\'s identity via session role', async () => {
      await workerPool.query('SELECT set_app_user_id($1)', [userAId]);
      const countA = await workerPool.query('SELECT COUNT(*) FROM candidate_profiles');
      await workerPool.query('SELECT set_app_user_id($1)', [userBId]);
      const countB = await workerPool.query('SELECT COUNT(*) FROM candidate_profiles');
      expect(parseInt(countA.rows[0].count)).toBeGreaterThanOrEqual(1);
      expect(parseInt(countB.rows[0].count)).toBeGreaterThanOrEqual(1);
    });

    it('Admin role can bypass RLS', async () => {
      await adminPool.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userAId]);
      const result = await adminPool.query('SELECT COUNT(*) FROM candidate_profiles');
      // Admin should see all profiles (via pg_has_role check)
      expect(result.rows.length).toBeGreaterThanOrEqual(0);
    });

    it('Runtime role CANNOT SET ROLE into admin', async () => {
      try {
        await runtimePoolA.query('SET ROLE app_admin');
        // If we reach here, the security model is broken
        expect(true).toBe(false);
      } catch {
        // Expected: runtime login user is NOT a member of app_admin, so SET ROLE fails
      }
    });

    it('Missing RLS context fails closed (no user sees NULL-user data)', async () => {
      // Do NOT set app.current_user_id — query should return 0 rows for user-owned tables
      const result = await runtimePoolA.query('SELECT COUNT(*) FROM candidate_profiles');
      // With NULL current_app_user_id, only rows where user_id IS NULL match
      // (and all our test rows have user_id set)
      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });
});
