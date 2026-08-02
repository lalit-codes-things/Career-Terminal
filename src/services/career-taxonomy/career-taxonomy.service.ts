/**
 * CareerTaxonomyService — Epic 4 Prompt 6
 *
 * Provides the canonical skill and occupation term sets used by the
 * resume-matching and extraction layers.
 *
 * ALL terms are sourced exclusively from the database (canonical_skills and
 * canonical_occupations tables).  No CSV files are read at runtime and no
 * hardcoded compatibility aliases exist here.
 *
 * The tables are populated by running:
 *   npx ts-node scripts/import-ontology.ts
 *
 * Query strategy:
 *  - getSkillTerms()      → canonical_name + all aliases from canonical_skills
 *  - getOccupationTerms() → canonical_name + all aliases from canonical_occupations
 *  - getRecords()         → structured TaxonomyRecord array for callers that
 *                           need source/kind metadata
 *
 * Caching:
 *  Terms are loaded once per process lifetime (module-level singleton).
 *  Call invalidateCache() in tests that need a clean slate.
 */

import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Public types (kept compatible with previous surface so callers don't break)
// ─────────────────────────────────────────────────────────────────────────────

export type TaxonomyKind = 'skill' | 'occupation';

export type TaxonomyRecord = {
  source: string;
  kind: TaxonomyKind;
  id: string;
  label: string;
  altLabels: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class CareerTaxonomyService {
  private loaded = false;
  private skillTerms = new Set<string>();
  private occupationTerms = new Set<string>();
  private records: TaxonomyRecord[] = [];

  async getSkillTerms(): Promise<string[]> {
    await this.load();
    return [...this.skillTerms];
  }

  async getOccupationTerms(): Promise<string[]> {
    await this.load();
    return [...this.occupationTerms];
  }

  async getRecords(): Promise<TaxonomyRecord[]> {
    await this.load();
    return this.records;
  }

  /** Reset cached state — use in tests only. */
  invalidateCache(): void {
    this.loaded = false;
    this.skillTerms.clear();
    this.occupationTerms.clear();
    this.records = [];
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    await Promise.all([this.loadSkillsFromDb(), this.loadOccupationsFromDb()]);

    logger.info('[CareerTaxonomy] Loaded taxonomy terms from database', {
      skills: this.skillTerms.size,
      occupations: this.occupationTerms.size,
      records: this.records.length,
    });
  }

  private async loadSkillsFromDb(): Promise<void> {
    const rows = await prisma.canonicalSkill.findMany({
      select: {
        id: true,
        canonicalName: true,
        source: true,
        aliases: { select: { alias: true } },
      },
    });

    for (const row of rows) {
      const label = row.canonicalName;
      this.skillTerms.add(label);

      const altLabels: string[] = [];
      for (const { alias } of row.aliases) {
        this.skillTerms.add(alias);
        altLabels.push(alias);
      }

      this.records.push({
        source: row.source.toLowerCase(),
        kind: 'skill',
        id: row.id,
        label,
        altLabels,
      });
    }
  }

  private async loadOccupationsFromDb(): Promise<void> {
    const rows = await prisma.canonicalOccupation.findMany({
      select: {
        id: true,
        canonicalName: true,
        source: true,
        aliases: { select: { alias: true } },
      },
    });

    for (const row of rows) {
      const label = row.canonicalName;
      this.occupationTerms.add(label);

      const altLabels: string[] = [];
      for (const { alias } of row.aliases) {
        this.occupationTerms.add(alias);
        altLabels.push(alias);
      }

      this.records.push({
        source: row.source.toLowerCase(),
        kind: 'occupation',
        id: row.id,
        label,
        altLabels,
      });
    }
  }
}

export const careerTaxonomyService = new CareerTaxonomyService();
