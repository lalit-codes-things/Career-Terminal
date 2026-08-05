/**
 * ResumeParserService
 *
 * Extracts structured observations from resume buffers (PDF, DOCX, plain text).
 *
 * The legacy taxonomy-based lexicon matching (canonical_skills /
 * canonical_occupations) has been removed.  Lexicon matching is now
 * done on-demand by AiTaxonomyService when called from ResumeIntelligenceService
 * or the resume-matcher.
 *
 * This class handles only:
 *   - Text extraction from binary buffers
 *   - Raw-text observations (evidence spans)
 *   - Experience and education heuristics
 */

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
  source: 'AI' | 'HEURISTIC' | 'RAW';
  metadata?: Record<string, unknown>;
}

export interface ParseResult {
  rawText: string;
  observations: ResumeObservation[];
  parserVersion: string;
  warnings: string[];
}

export interface IResumeParser {
  parse(buffer: Buffer, mimetype: string): Promise<ParseResult>;
  getVersion(): string;
}

export class ResumeParserService implements IResumeParser {
  private readonly parserVersion = 'resume-parser-v2';

  getVersion(): string {
    return this.parserVersion;
  }

  async parse(buffer: Buffer, mimetype: string): Promise<ParseResult> {
    const rawText = await this.extractText(buffer, mimetype);
    const observations: ResumeObservation[] = [];
    const warnings: string[] = [];

    // Raw-text observations — every non-empty line becomes a RAW observation
    // for downstream AI to classify.  No keyword matching here.
    for (const line of rawText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length < 4) continue;
      observations.push({
        category: 'RAW_TEXT',
        value: trimmed,
        evidence: trimmed,
        confidence: 0.2,
        source: 'RAW',
        metadata: { lineLength: trimmed.length },
      });
    }

    if (observations.length === 0) {
      warnings.push(
        'No observations extracted — document may be malformed, empty, or image-based PDF without OCR',
      );
    }

    return { rawText, observations, parserVersion: this.parserVersion, warnings };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async extractText(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === 'application/pdf') {
      try {
        const pdfParseModule = await import('pdf-parse');
        const parse = (pdfParseModule.default || pdfParseModule) as unknown as (
          b: Buffer,
        ) => Promise<{ text: string }>;
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
}

export const resumeParserService = new ResumeParserService();
