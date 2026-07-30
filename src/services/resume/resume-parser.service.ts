/**
 * Resume Parser — Epic 4 Prompt 14
 *
 * Compatibility layer that separates reliable extraction from fabricated heuristics.
 *
 * Pipeline:
 *   Document
 *   → extracted text
 *   → structured observations
 *   → evidence/confidence
 *
 * Design goals:
 *   - Never fabricate years of experience, roles, companies, education, or proficiency.
 *   - Lexicon matches are backed by O*NET/ESCO taxonomy with explicit evidence spans.
 *   - Observations carry confidence and raw source evidence.
 *   - Parser is replaceable via IResumeParser without touching the canonical domain.
 */

import { careerTaxonomyService } from '../career-taxonomy/career-taxonomy.service';
import type { CareerTaxonomyService } from '../career-taxonomy/career-taxonomy.service';

// ─────────────────────────────────────────────────────────────────────────────
// Observation types
// ─────────────────────────────────────────────────────────────────────────────

export type ObservationCategory =
  | 'SKILL'
  | 'OCCUPATION'
  | 'TECHNOLOGY'
  | 'EXPERIENCE'
  | 'EDUCATION'
  | 'LANGUAGE'
  | 'CERTIFICATION'
  | 'LOCATION'
  | 'RAW_TEXT';

export interface ResumeObservation {
  category: ObservationCategory;
  value: string;
  evidence: string;
  confidence: number;
  source: 'ONET' | 'ESCO' | 'HEURISTIC' | 'RAW';
  metadata?: Record<string, unknown>;
}

export interface ParseResult {
  rawText: string;
  observations: ResumeObservation[];
  parserVersion: string;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser interface
// ─────────────────────────────────────────────────────────────────────────────

export interface IResumeParser {
  parse(buffer: Buffer, mimetype: string): Promise<ParseResult>;
  getVersion(): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default parser implementation
// ─────────────────────────────────────────────────────────────────────────────

export class ResumeParserService implements IResumeParser {
  private readonly taxonomy: CareerTaxonomyService;
  private readonly parserVersion = 'resume-parser-v1';

  constructor(taxonomy?: CareerTaxonomyService) {
    this.taxonomy = taxonomy ?? careerTaxonomyService;
  }

  getVersion(): string {
    return this.parserVersion;
  }

  async parseResumeObservations(text: string): Promise<ResumeObservation[]> {
    const lowerText = text.toLowerCase();
    const observations: ResumeObservation[] = [];

    const skillTerms = await this.taxonomy.getSkillTerms();
    for (const term of skillTerms) {
      const match = this.findMatch(lowerText, term);
      if (match) {
        observations.push({
          category: 'SKILL',
          value: term,
          evidence: match.context,
          confidence: 0.9,
          source: match.alias ? 'ESCO' : 'ONET',
          metadata: { matchedTerm: match.matchedTerm, start: match.start, end: match.end },
        });
      }
    }

    const occupationTerms = await this.taxonomy.getOccupationTerms();
    for (const term of occupationTerms) {
      const match = this.findMatch(lowerText, term);
      if (match) {
        observations.push({
          category: 'OCCUPATION',
          value: term,
          evidence: match.context,
          confidence: 0.85,
          source: match.alias ? 'ESCO' : 'ONET',
          metadata: { matchedTerm: match.matchedTerm, start: match.start, end: match.end },
        });
      }
    }

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const hasLexiconHit = observations.some(
        (o) => o.evidence.includes(trimmed) || trimmed.toLowerCase().includes(o.value.toLowerCase()),
      );

      if (!hasLexiconHit) {
        observations.push({
          category: 'RAW_TEXT',
          value: trimmed,
          evidence: trimmed,
          confidence: 0.2,
          source: 'RAW',
          metadata: { lineLength: trimmed.length },
        });
      }
    }

    return observations;
  }

  async parse(buffer: Buffer, mimetype: string): Promise<ParseResult> {
    const rawText = await this.extractText(buffer, mimetype);
    const observations: ResumeObservation[] = [];
    const warnings: string[] = [];

    const lowerText = rawText.toLowerCase();

    // 1. Lexicon-based observations (reliable — backed by O*NET/ESCO)
    const skillTerms = await this.taxonomy.getSkillTerms();
    for (const term of skillTerms) {
      const match = this.findMatch(lowerText, term);
      if (match) {
        observations.push({
          category: 'SKILL',
          value: term,
          evidence: match.context,
          confidence: 0.9,
          source: match.alias ? 'ESCO' : 'ONET',
          metadata: { matchedTerm: match.matchedTerm, start: match.start, end: match.end },
        });
      }
    }

    const occupationTerms = await this.taxonomy.getOccupationTerms();
    for (const term of occupationTerms) {
      const match = this.findMatch(lowerText, term);
      if (match) {
        observations.push({
          category: 'OCCUPATION',
          value: term,
          evidence: match.context,
          confidence: 0.85,
          source: match.alias ? 'ESCO' : 'ONET',
          metadata: { matchedTerm: match.matchedTerm, start: match.start, end: match.end },
        });
      }
    }

    // 2. Raw text observations for unclassified but present content
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const hasLexiconHit = observations.some(
        (o) => o.evidence.includes(trimmed) || trimmed.toLowerCase().includes(o.value.toLowerCase()),
      );

      if (!hasLexiconHit) {
        observations.push({
          category: 'RAW_TEXT',
          value: trimmed,
          evidence: trimmed,
          confidence: 0.2,
          source: 'RAW',
          metadata: { lineLength: trimmed.length },
        });
      }
    }

    if (observations.length === 0) {
      warnings.push('No observations extracted — document may be malformed, empty, or image-based PDF without OCR');
    }

    return {
      rawText,
      observations,
      parserVersion: this.parserVersion,
      warnings,
    };
  }

  private async extractText(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === 'application/pdf') {
      try {
        const pdfParseModule = await import('pdf-parse');
        const parse = (pdfParseModule.default || pdfParseModule) as unknown as (b: Buffer) => Promise<{ text: string }>;
        const data = await parse(buffer);
        return data.text;
      } catch {
        return '';
      }
    }
    if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/msword'
    ) {
      try {
        // @ts-expect-error mammoth has no type declarations
        const mammothModule = await import('mammoth');
        const mammoth = mammothModule.default || mammothModule;
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      } catch {
        return buffer.toString('utf-8');
      }
    }
    return buffer.toString('utf-8');
  }

  private findMatch(text: string, term: string): { matchedTerm: string; context: string; start: number; end: number; alias?: boolean } | null {
    if (!term) return null;
    const normalized = term.toLowerCase().trim();
    if (!normalized || normalized.length < 3) return null;

    let start = text.indexOf(normalized);
    if (start !== -1) {
      const end = start + normalized.length;
      return { matchedTerm: term, context: this.extractContext(text, start, end), start, end };
    }

    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const start = match.index + (match[1]?.length ?? 0);
      const end = start + normalized.length;
      return { matchedTerm: term, context: this.extractContext(text, start, end), start, end };
    }

    return null;
  }

  private extractContext(text: string, start: number, end: number): string {
    const contextRadius = 80;
    const from = Math.max(0, start - contextRadius);
    const to = Math.min(text.length, end + contextRadius);
    let context = text.slice(from, to).replace(/\s+/g, ' ').trim();
    if (from > 0) context = '...' + context;
    if (to < text.length) context = context + '...';
    return context;
  }
}

export const resumeParserService = new ResumeParserService();
