/**
 * Interview Competency Taxonomy Seed.
 *
 * Idempotently upserts the starter competency catalog so extraction and
 * simulation have a stable set of keys to reference.  Rows are keyed on the
 * unique `key` column; re-running this script is safe.
 *
 * Usage:
 *   npx tsx scripts/db/seed-interview-competencies.ts
 *
 * Wire into package.json:
 *   "seed:interview-competencies": "tsx scripts/db/seed-interview-competencies.ts"
 */

import 'dotenv/config';
import { prisma } from '../../src/config/database';
import { logger } from '../../src/lib/logger';

interface CompetencyRow {
  key: string;
  name: string;
  category: 'HARD_SKILL' | 'SOFT_SKILL' | 'LEADERSHIP' | 'MANAGEMENT' | 'EXECUTIVE';
  parentCompetencyId?: string;
  description?: string;
}

const COMPETENCIES: CompetencyRow[] = [
  // ─── HARD_SKILL ────────────────────────────────────────────────────────────
  { key: 'system_design', name: 'System Design', category: 'HARD_SKILL' },
  { key: 'caching', name: 'Caching', category: 'HARD_SKILL', parentCompetencyId: 'system_design' },
  { key: 'consistency_models', name: 'Consistency Models', category: 'HARD_SKILL', parentCompetencyId: 'system_design' },
  { key: 'sharding', name: 'Sharding', category: 'HARD_SKILL', parentCompetencyId: 'system_design' },
  { key: 'load_balancing', name: 'Load Balancing', category: 'HARD_SKILL', parentCompetencyId: 'system_design' },
  { key: 'failure_recovery', name: 'Failure Recovery', category: 'HARD_SKILL', parentCompetencyId: 'system_design' },
  { key: 'capacity_estimation', name: 'Capacity Estimation', category: 'HARD_SKILL', parentCompetencyId: 'system_design' },

  { key: 'algorithms', name: 'Algorithms', category: 'HARD_SKILL' },
  { key: 'complexity_analysis', name: 'Complexity Analysis', category: 'HARD_SKILL', parentCompetencyId: 'algorithms' },
  { key: 'data_structures', name: 'Data Structures', category: 'HARD_SKILL', parentCompetencyId: 'algorithms' },
  { key: 'optimization', name: 'Optimization', category: 'HARD_SKILL', parentCompetencyId: 'algorithms' },

  { key: 'coding_practice', name: 'Coding Practice', category: 'HARD_SKILL' },
  { key: 'debugging', name: 'Debugging', category: 'HARD_SKILL', parentCompetencyId: 'coding_practice' },
  { key: 'code_review', name: 'Code Review', category: 'HARD_SKILL', parentCompetencyId: 'coding_practice' },
  { key: 'testing', name: 'Testing', category: 'HARD_SKILL', parentCompetencyId: 'coding_practice' },

  { key: 'domain_expertise', name: 'Domain Expertise', category: 'HARD_SKILL' },
  { key: 'security', name: 'Security', category: 'HARD_SKILL', parentCompetencyId: 'domain_expertise' },
  { key: 'data_engineering', name: 'Data Engineering', category: 'HARD_SKILL', parentCompetencyId: 'domain_expertise' },
  { key: 'ml_systems', name: 'ML Systems', category: 'HARD_SKILL', parentCompetencyId: 'domain_expertise' },
  { key: 'mobile', name: 'Mobile', category: 'HARD_SKILL', parentCompetencyId: 'domain_expertise' },
  { key: 'frontend_architecture', name: 'Frontend Architecture', category: 'HARD_SKILL', parentCompetencyId: 'domain_expertise' },

  // ─── SOFT_SKILL ────────────────────────────────────────────────────────────
  { key: 'communication', name: 'Communication', category: 'SOFT_SKILL' },
  { key: 'clarity', name: 'Clarity', category: 'SOFT_SKILL', parentCompetencyId: 'communication' },
  { key: 'structured_thinking', name: 'Structured Thinking', category: 'SOFT_SKILL', parentCompetencyId: 'communication' },
  { key: 'active_listening', name: 'Active Listening', category: 'SOFT_SKILL', parentCompetencyId: 'communication' },

  { key: 'collaboration', name: 'Collaboration', category: 'SOFT_SKILL' },
  { key: 'conflict_resolution', name: 'Conflict Resolution', category: 'SOFT_SKILL', parentCompetencyId: 'collaboration' },
  { key: 'giving_feedback', name: 'Giving Feedback', category: 'SOFT_SKILL', parentCompetencyId: 'collaboration' },

  { key: 'problem_solving', name: 'Problem Solving', category: 'SOFT_SKILL' },
  { key: 'trade_off_analysis', name: 'Trade-off Analysis', category: 'SOFT_SKILL', parentCompetencyId: 'problem_solving' },
  { key: 'ambiguity_handling', name: 'Ambiguity Handling', category: 'SOFT_SKILL', parentCompetencyId: 'problem_solving' },

  { key: 'adaptability', name: 'Adaptability', category: 'SOFT_SKILL' },

  // ─── LEADERSHIP ────────────────────────────────────────────────────────────
  { key: 'ownership', name: 'Ownership', category: 'LEADERSHIP' },
  { key: 'influencing_without_authority', name: 'Influencing Without Authority', category: 'LEADERSHIP' },
  { key: 'mentorship', name: 'Mentorship', category: 'LEADERSHIP' },
  { key: 'decision_making_under_uncertainty', name: 'Decision Making Under Uncertainty', category: 'LEADERSHIP' },

  // ─── MANAGEMENT ────────────────────────────────────────────────────────────
  { key: 'people_management', name: 'People Management', category: 'MANAGEMENT' },
  { key: 'org_design', name: 'Org Design', category: 'MANAGEMENT' },

  // ─── EXECUTIVE ─────────────────────────────────────────────────────────────
  { key: 'strategic_planning', name: 'Strategic Planning', category: 'EXECUTIVE' },
  { key: 'stakeholder_management', name: 'Stakeholder Management', category: 'EXECUTIVE' },
];

async function main(): Promise<void> {
  logger.info('[seed-interview-competencies] Starting', { count: COMPETENCIES.length });

  const parentMap = new Map<string, string>();
  for (const row of COMPETENCIES) {
    if (row.parentCompetencyId) {
      parentMap.set(row.key, row.parentCompetencyId);
    }
  }

  const created: string[] = [];
  const updated: string[] = [];

  for (const row of COMPETENCIES) {
    const parentId = row.parentCompetencyId
      ? (await prisma.interviewCompetency.findUnique({ where: { key: row.parentCompetencyId } }))?.id
      : null;

    if (!parentId && row.parentCompetencyId) {
      logger.warn('[seed-interview-competencies] Parent not found, skipping child', { key: row.key, parent: row.parentCompetencyId });
      continue;
    }

    const result = await prisma.interviewCompetency.upsert({
      where: { key: row.key },
      create: {
        key: row.key,
        name: row.name,
        category: row.category,
        parentCompetencyId: parentId ?? undefined,
        description: row.description,
        isActive: true,
      },
      update: {
        name: row.name,
        category: row.category,
        parentCompetencyId: parentId ?? undefined,
        description: row.description,
        isActive: true,
      },
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created.push(row.key);
    } else {
      updated.push(row.key);
    }
  }

  logger.info('[seed-interview-competencies] Complete', { created: created.length, updated: updated.length, total: COMPETENCIES.length });
}

void main();
