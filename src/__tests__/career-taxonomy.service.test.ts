/**
 * CareerTaxonomyService — Tests (Epic 4 Prompt 6)
 *
 * Asserts:
 *  1. Terms are loaded from the database (canonicalSkill / canonicalOccupation),
 *     NOT from CSV files — fs.readFile must never be called.
 *  2. Both canonical names and alias variants are returned.
 *  3. getRecords() returns structured TaxonomyRecord objects with source/kind.
 *  4. Results are cached after the first call (only one DB round-trip per
 *     process lifetime).
 *  5. invalidateCache() resets state so the next call re-queries the DB.
 *  6. Empty DB tables result in empty term sets (no crash, no hardcoded fallback).
 */

import * as fs from 'fs/promises';

// ── Mock database — must be declared before any import that touches prisma ──

jest.mock('../config/database', () => ({
  prisma: {
    canonicalSkill: {
      findMany: jest.fn(),
    },
    canonicalOccupation: {
      findMany: jest.fn(),
    },
  },
}));

// fs must NEVER be called — fail loudly if it is.
jest.mock('fs/promises', () => ({
  readFile: jest.fn(() => {
    throw new Error('fs.readFile must not be called — CareerTaxonomyService must use the DB');
  }),
}));

import { prisma } from '../config/database';
import { CareerTaxonomyService } from '../services/career-taxonomy/career-taxonomy.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DB_SKILLS = [
  {
    id: 'skill-uuid-1',
    canonicalName: 'data analysis',
    source: 'ESCO',
    aliases: [{ alias: 'data analytics' }, { alias: 'analysing data' }],
  },
  {
    id: 'skill-uuid-2',
    canonicalName: 'project management',
    source: 'ONET',
    aliases: [],
  },
];

const DB_OCCUPATIONS = [
  {
    id: 'occ-uuid-1',
    canonicalName: 'civil engineer',
    source: 'ESCO',
    aliases: [{ alias: 'structural engineer' }],
  },
  {
    id: 'occ-uuid-2',
    canonicalName: 'nurse',
    source: 'ONET',
    aliases: [{ alias: 'registered nurse' }, { alias: 'rn' }],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockDbReturns() {
  (prisma.canonicalSkill.findMany as jest.Mock).mockResolvedValue(DB_SKILLS);
  (prisma.canonicalOccupation.findMany as jest.Mock).mockResolvedValue(DB_OCCUPATIONS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CareerTaxonomyService', () => {
  let svc: CareerTaxonomyService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CareerTaxonomyService();
    mockDbReturns();
  });

  // ── 1. DB queries, no CSV loading ──────────────────────────────────────────

  it('queries canonicalSkill and canonicalOccupation tables — never calls fs.readFile', async () => {
    await svc.getSkillTerms();

    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.canonicalOccupation.findMany).toHaveBeenCalledTimes(1);

    // If fs.readFile were called the mock above would throw; reaching here
    // means it was never invoked.
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('selects canonical_name and aliases in the DB query', async () => {
    await svc.getSkillTerms();

    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          canonicalName: true,
          aliases: expect.anything(),
        }),
      }),
    );
  });

  // ── 2. Canonical names and aliases are all returned ────────────────────────

  it('getSkillTerms includes canonical names', async () => {
    const terms = await svc.getSkillTerms();

    expect(terms).toContain('data analysis');
    expect(terms).toContain('project management');
  });

  it('getSkillTerms includes alias variants from the aliases relation', async () => {
    const terms = await svc.getSkillTerms();

    expect(terms).toContain('data analytics');
    expect(terms).toContain('analysing data');
  });

  it('getOccupationTerms includes canonical names', async () => {
    const terms = await svc.getOccupationTerms();

    expect(terms).toContain('civil engineer');
    expect(terms).toContain('nurse');
  });

  it('getOccupationTerms includes alias variants', async () => {
    const terms = await svc.getOccupationTerms();

    expect(terms).toContain('structural engineer');
    expect(terms).toContain('registered nurse');
    expect(terms).toContain('rn');
  });

  it('does not contain any hardcoded compat aliases (javascript, react, node.js, etc.)', async () => {
    const terms = await svc.getSkillTerms();

    const compatTerms = [
      'javascript',
      'typescript',
      'react',
      'node.js',
      'aws',
      'docker',
      'kubernetes',
      'git',
      'python',
      'graphql',
      'ci/cd',
    ];
    for (const t of compatTerms) {
      expect(terms).not.toContain(t);
    }
  });

  // ── 3. getRecords() returns structured TaxonomyRecord objects ─────────────

  it('getRecords returns entries with correct source and kind for skills', async () => {
    const records = await svc.getRecords();

    const skillRecord = records.find((r) => r.id === 'skill-uuid-1');
    expect(skillRecord).toBeDefined();
    expect(skillRecord!.kind).toBe('skill');
    expect(skillRecord!.source).toBe('esco');
    expect(skillRecord!.label).toBe('data analysis');
    expect(skillRecord!.altLabels).toContain('data analytics');
  });

  it('getRecords returns entries with correct source and kind for occupations', async () => {
    const records = await svc.getRecords();

    const occRecord = records.find((r) => r.id === 'occ-uuid-1');
    expect(occRecord).toBeDefined();
    expect(occRecord!.kind).toBe('occupation');
    expect(occRecord!.source).toBe('esco');
    expect(occRecord!.label).toBe('civil engineer');
    expect(occRecord!.altLabels).toContain('structural engineer');
  });

  it('getRecords contains both skill and occupation entries', async () => {
    const records = await svc.getRecords();

    const skills = records.filter((r) => r.kind === 'skill');
    const occupations = records.filter((r) => r.kind === 'occupation');
    expect(skills.length).toBe(DB_SKILLS.length);
    expect(occupations.length).toBe(DB_OCCUPATIONS.length);
  });

  // ── 4. Results are cached — only one DB round-trip ────────────────────────

  it('calling getSkillTerms twice triggers only one DB query', async () => {
    await svc.getSkillTerms();
    await svc.getSkillTerms();

    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledTimes(1);
  });

  it('calling getOccupationTerms after getSkillTerms does not repeat the skill query', async () => {
    await svc.getSkillTerms();
    await svc.getOccupationTerms();

    // Both queries happen on the first load() call; the second call is cached.
    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.canonicalOccupation.findMany).toHaveBeenCalledTimes(1);
  });

  it('calling getRecords after getSkillTerms reuses the same loaded data', async () => {
    await svc.getSkillTerms();
    await svc.getRecords();

    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledTimes(1);
  });

  // ── 5. invalidateCache() resets state for the next query ─────────────────

  it('invalidateCache causes the next call to re-query the DB', async () => {
    await svc.getSkillTerms();
    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledTimes(1);

    svc.invalidateCache();
    await svc.getSkillTerms();
    expect(prisma.canonicalSkill.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache clears previously loaded terms', async () => {
    await svc.getSkillTerms();

    // Simulate DB returning empty tables after cache clear
    (prisma.canonicalSkill.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.canonicalOccupation.findMany as jest.Mock).mockResolvedValue([]);

    svc.invalidateCache();
    const terms = await svc.getSkillTerms();
    expect(terms).toHaveLength(0);
  });

  // ── 6. Empty DB → empty term sets, no crash or hardcoded fallback ─────────

  it('returns empty arrays when DB tables are empty', async () => {
    (prisma.canonicalSkill.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.canonicalOccupation.findMany as jest.Mock).mockResolvedValue([]);

    const skills = await svc.getSkillTerms();
    const occupations = await svc.getOccupationTerms();
    const records = await svc.getRecords();

    expect(skills).toHaveLength(0);
    expect(occupations).toHaveLength(0);
    expect(records).toHaveLength(0);
  });

  it('does not inject any fallback terms when the DB returns nothing', async () => {
    (prisma.canonicalSkill.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.canonicalOccupation.findMany as jest.Mock).mockResolvedValue([]);

    const skills = await svc.getSkillTerms();
    expect(skills.length).toBe(0);
  });
});
