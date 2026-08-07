/**
 * AiTaxonomyService
 *
 * Extracts skill and occupation terms from text using the AI extraction
 * pipeline.  This is the sole taxonomy source — canonical_skills and
 * canonical_occupations tables have been removed.
 *
 * Skills and occupations extracted by AI are:
 *   - Returned as plain string lists for lexicon matching
 *   - Written to RecruiterFact (factType = 'ai_taxonomy.skill' / 'ai_taxonomy.occupation')
 *     when a real recruiter entity ID is provided, keeping results auditable
 *
 * Architecture:
 *   getSkillTerms(text)      → calls extract capability, returns skill names
 *   getOccupationTerms(text) → calls extract capability, returns occupation names
 *   matchSkills(text)        → returns {term, confidence}[] with evidence
 *   matchOccupations(text)   → same
 */

import { randomUUID } from 'crypto';
import { pipeline } from '../recruiter-intelligence/ai/pipeline.factory';
import { dbRouter } from '../../config/database';
import type { ExtractionInput } from '../recruiter-intelligence/ai/types';

export interface TaxonomyMatch {
  term: string;
  confidence: number;
  evidence: string;
  factId?: string;
}

export class AiTaxonomyService {
  /** Extract skill terms from text. Returns plain string list. */
  async getSkillTerms(text: string): Promise<string[]> {
    const matches = await this.matchSkills(text, 'system', 'system');
    return matches.map((m) => m.term);
  }

  /** Extract occupation terms from text. Returns plain string list. */
  async getOccupationTerms(text: string): Promise<string[]> {
    const matches = await this.matchOccupations(text, 'system', 'system');
    return matches.map((m) => m.term);
  }

  /** Full skill extraction with confidence + evidence. */
  async matchSkills(text: string, userId: string, entityId: string): Promise<TaxonomyMatch[]> {
    return this.extractTaxonomyTerms(text, userId, entityId, 'skill');
  }

  /** Full occupation extraction with confidence + evidence. */
  async matchOccupations(text: string, userId: string, entityId: string): Promise<TaxonomyMatch[]> {
    return this.extractTaxonomyTerms(text, userId, entityId, 'occupation');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async extractTaxonomyTerms(
    text: string,
    userId: string,
    entityId: string,
    kind: 'skill' | 'occupation',
  ): Promise<TaxonomyMatch[]> {
    const extractionId = randomUUID();

    const aiInput: ExtractionInput = {
      extractionId,
      tenantId: userId,
      sourceType: 'document',
      sourceId: entityId,
      content: text.slice(0, 8000),
      metadata: { extractionKind: kind },
      requestedAt: new Date(),
    };

    let output;
    try {
      output = await pipeline.extract('recruiter-entity-extraction', aiInput, {});
    } catch {
      return [];
    }

    const kindFilter = kind === 'skill' ? ['skill', 'technology'] : ['recruiter_title', 'occupation'];

    const matches: TaxonomyMatch[] = [];

    for (const field of output.fields) {
      if (!kindFilter.includes(field.field)) continue;

      const term = typeof field.value === 'object' && field.value !== null
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        ? String((field.value as Record<string, unknown>)['name'] ?? field.rawValue)
        : field.rawValue;

      if (!term || term.length < 2) continue;

      const excerpt = field.evidence.map((e) => e.excerpt).join(' | ');
      let factId: string | undefined;

      if (entityId !== 'system') {
        try {
          const fact = await dbRouter.write().recruiterFact.create({
            data: {
              recruiterId: entityId,
              factType: `ai_taxonomy.${kind}`,
              factValue: { term, kind },
              confidence: field.confidence,
              verificationStatus: field.confidence >= 0.75 ? 'VERIFIED' : 'PENDING',
              validFrom: new Date(),
              source: `ai-taxonomy:${kind}`,
              provenanceJson: {
                extractionId,
                model: output.model,
                provider: output.provider,
                templateId: output.templateId,
              },
              evidenceJson: field.evidence.map((e) => ({ excerpt: e.excerpt, confidence: e.confidence })),
            },
          });
          factId = fact.id;
        } catch {
          // Non-fatal
        }
      }

      matches.push({ term, confidence: field.confidence, evidence: excerpt, factId });
    }

    return matches;
  }
}

export const aiTaxonomyService = new AiTaxonomyService();
