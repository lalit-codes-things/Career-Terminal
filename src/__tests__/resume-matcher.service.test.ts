/**
 * ResumeMatcherService tests — Epic 4 Prompt 6
 *
 * The skill lexicon is now sourced exclusively from the database-backed
 * CareerTaxonomyService (canonical_skills / canonical_occupations tables).
 * There are no hardcoded compat aliases.
 *
 * These tests mock the DB so that only the terms we explicitly seed are
 * available — making the assertions independent of the real dataset.
 */

// ── Mock DB (must come before any service imports) ───────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    canonicalSkill: { findMany: jest.fn() },
    canonicalOccupation: { findMany: jest.fn() },
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { ResumeMatcherService } from '../services/resume-matcher/resume-matcher.service';
import { careerTaxonomyService } from '../services/career-taxonomy/career-taxonomy.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal canonical skill row (what prisma.canonicalSkill.findMany returns). */
function skillRow(name: string, source = 'ESCO', aliases: string[] = []) {
  return {
    id: `id-${name}`,
    canonicalName: name,
    source,
    aliases: aliases.map((a) => ({ alias: a })),
  };
}

function occupationRow(name: string, source = 'ESCO', aliases: string[] = []) {
  return {
    id: `id-${name}`,
    canonicalName: name,
    source,
    aliases: aliases.map((a) => ({ alias: a })),
  };
}

/** Seed the mock DB and reset the taxonomy cache so the next call reloads. */
function seedOntology(
  skills: ReturnType<typeof skillRow>[],
  occupations: ReturnType<typeof occupationRow>[] = [],
) {
  (prisma.canonicalSkill.findMany as jest.Mock).mockResolvedValue(skills);
  (prisma.canonicalOccupation.findMany as jest.Mock).mockResolvedValue(occupations);
  careerTaxonomyService.invalidateCache();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ResumeMatcherService', () => {
  let service: ResumeMatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResumeMatcherService();
  });

  // ── parseResume ─────────────────────────────────────────────────────────────

  it('detects skills that are present in the DB ontology', async () => {
    // Seed three profession-neutral terms drawn from real ESCO/ONET data.
    seedOntology([
      skillRow('data analysis'),
      skillRow('project management'),
      skillRow('statistical analysis'),
    ]);

    const text =
      'I have strong skills in data analysis, statistical analysis, and project management.';
    const parsed = await service.parseResume(text);

    expect(parsed.skills).toContain('data analysis');
    expect(parsed.skills).toContain('statistical analysis');
    expect(parsed.skills).toContain('project management');
  });

  it('detects skills via alias when the canonical name is not in the text', async () => {
    seedOntology([skillRow('data analysis', 'ESCO', ['analysing data', 'data analytics'])]);

    const parsed = await service.parseResume('Experienced in data analytics and reporting.');

    expect(parsed.skills).toContain('data analytics');
  });

  it('does not return skills that are absent from the DB ontology', async () => {
    // Only seed one term — resume text mentions others that are not in DB.
    seedOntology([skillRow('budgeting')]);

    const text = 'I am experienced in machine learning, cloud infrastructure, and budgeting.';
    const parsed = await service.parseResume(text);

    // 'machine learning' and 'cloud infrastructure' not seeded — must not appear.
    expect(parsed.skills).not.toContain('machine learning');
    expect(parsed.skills).not.toContain('cloud infrastructure');
    // 'budgeting' is seeded — should be detected.
    expect(parsed.skills).toContain('budgeting');
  });

  it('returns empty skills array when DB ontology is empty', async () => {
    seedOntology([]);

    const text = 'Expert in TypeScript, React, and Node.js with 8 years experience.';
    const parsed = await service.parseResume(text);

    expect(parsed.skills).toHaveLength(0);
  });

  it('extracts experience entries with explicit evidence only', async () => {
    seedOntology([]);

    const text = `Senior nurse with experience in patient care and clinical assessment.
    Nurse at City Hospital (2018-2023)`;
    const parsed = await service.parseResume(text);

    expect(parsed.experience.length).toBeGreaterThan(0);
    expect(parsed.experience[0]?.raw).toContain('City Hospital');
  });

  it('returns empty experience array when no explicit experience patterns are found', async () => {
    seedOntology([]);

    const text = 'I am a marketing intern who assisted with campaign analysis.';
    const parsed = await service.parseResume(text);

    expect(parsed.experience).toHaveLength(0);
  });

  it('extracts education entries with explicit evidence only', async () => {
    seedOntology([]);

    const text = `Bachelor of Science in Computer Science from State University`;
    const parsed = await service.parseResume(text);

    expect(parsed.education.length).toBeGreaterThan(0);
    expect(parsed.education[0]?.raw).toContain('Bachelor');
  });

  // ── scoreMatch ──────────────────────────────────────────────────────────────

  it('calculates overall score > 0.5 when resume and job share ontology terms', async () => {
    seedOntology([
      skillRow('financial modelling'),
      skillRow('excel'),
      skillRow('budgeting'),
      skillRow('risk assessment', 'ONET', ['risk analysis']),
    ]);

    const resumeText = 'Finance analyst skilled in financial modelling, excel, and budgeting.';
    const jobText =
      'Seeking finance analyst with financial modelling, excel, risk assessment skills.';

    const score = await service.scoreMatch(resumeText, jobText);

    expect(score.overallScore).toBeGreaterThan(0.5);
    expect(score.skillMatch).toBeGreaterThan(0.5);
  });

  it('identifies missing skills that appear in the job but not the resume', async () => {
    seedOntology([skillRow('financial modelling'), skillRow('forecasting'), skillRow('sql')]);

    const resumeText = 'I know financial modelling and some excel work.';
    const jobText = 'Need financial modelling, forecasting, and sql skills.';

    const score = await service.scoreMatch(resumeText, jobText);

    // 'forecasting' and 'sql' are in the job but not in the resume text.
    expect(score.missingSkills).toContain('forecasting');
    expect(score.missingSkills).toContain('sql');
  });

  it('returns experienceMatch = 1.0 when job does not specify an experience requirement', async () => {
    seedOntology([skillRow('accounting'), skillRow('auditing')]);

    const resumeText = 'I am an accountant experienced in accounting and auditing.';
    const jobText = 'Looking for an accountant who knows accounting, auditing.';

    const score = await service.scoreMatch(resumeText, jobText);

    expect(score.experienceMatch).toBe(1.0);
  });

  it('returns experienceMatch = 1.0 when resume explicitly states meeting seniority', async () => {
    seedOntology([skillRow('nursing'), skillRow('patient care')]);

    const resumeText = 'Senior nurse with 5 years of nursing and patient care experience.';
    const jobText = 'Senior nurse needed who knows nursing and patient care.';

    const score = await service.scoreMatch(resumeText, jobText);

    expect(score.experienceMatch).toBe(1.0);
  });

  it('score is 1.0 with empty ontology when job has no required skills', async () => {
    seedOntology([]);

    const score = await service.scoreMatch('I have various skills.', 'General role available.');

    // Both skill and tech sets are empty → default to 1.0.
    expect(score.skillMatch).toBe(1.0);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  // ── Ontology isolation (regression guard) ────────────────────────────────

  it('taxonomy cache is isolated between test cases via invalidateCache', async () => {
    // First case — only 'budgeting' is available.
    seedOntology([skillRow('budgeting')]);
    const first = await service.parseResume('I work in budgeting and forecasting.');
    expect(first.skills).toContain('budgeting');
    expect(first.skills).not.toContain('forecasting');

    // Second case — 'forecasting' added; cache reset by seedOntology.
    seedOntology([skillRow('budgeting'), skillRow('forecasting')]);
    const second = await service.parseResume('I work in budgeting and forecasting.');
    expect(second.skills).toContain('forecasting');
  });
});
