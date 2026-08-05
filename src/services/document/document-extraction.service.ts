/**
 * DocumentExtractionService
 *
 * Sole responsibility: extract raw text from binary document buffers.
 * Knows nothing about resumes, skills, or intelligence.
 *
 * Supported formats:
 *   - PDF          (via pdf-parse)
 *   - DOCX / DOC   (via mammoth)
 *   - Plain text   (pass-through)
 *
 * Output contract:
 *   { rawText, pages?, parserVersion, warnings }
 *
 * What happens AFTER extraction is entirely the concern of downstream services:
 *   DocumentExtractionService → raw text → AI extraction → Facts → Knowledge Graph
 *
 * Works for any document type: resumes, CVs, cover letters, offer letters,
 * recommendation letters, transcripts — no resume-specific assumptions here.
 */

export interface ExtractionResult {
  /** Full extracted text, whitespace-normalised but otherwise unmodified. */
  rawText: string;
  /**
   * Per-page text when the format supports it (PDF).
   * Undefined when the format has no page concept (DOCX, TXT).
   */
  pages?: string[];
  /** Semver-style version of the extraction logic so results are reproducible. */
  parserVersion: string;
  /** Non-fatal issues encountered during extraction (e.g. encrypted PDF). */
  warnings: string[];
}

export class DocumentExtractionService {
  private readonly version = 'document-extractor-v1';

  getVersion(): string {
    return this.version;
  }

  async extract(buffer: Buffer, mimetype: string): Promise<ExtractionResult> {
    const warnings: string[] = [];

    if (mimetype === 'application/pdf') {
      return this.extractPdf(buffer, warnings);
    }

    if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/msword'
    ) {
      return this.extractDocx(buffer, warnings);
    }

    if (mimetype === 'text/plain' || mimetype === 'text/markdown') {
      const rawText = buffer.toString('utf-8');
      return { rawText, parserVersion: this.version, warnings };
    }

    // Fallback: attempt UTF-8 decode
    warnings.push(`Unsupported MIME type '${mimetype}', falling back to UTF-8 text decode.`);
    const rawText = buffer.toString('utf-8');
    return { rawText, parserVersion: this.version, warnings };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async extractPdf(buffer: Buffer, warnings: string[]): Promise<ExtractionResult> {
    try {
      const pdfParseModule = await import('pdf-parse');
      const parse = (pdfParseModule.default || pdfParseModule) as unknown as (
        b: Buffer,
        opts?: { pagerender?: (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => Promise<string> }
      ) => Promise<{ text: string; numpages: number }>;

      // First pass: full text
      const data = await parse(buffer);
      const rawText = data.text.trim();

      if (!rawText) {
        warnings.push('PDF produced no text — may be image-based or encrypted. Consider OCR.');
      }

      return { rawText, parserVersion: this.version, warnings };
    } catch (err) {
      warnings.push(`PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      return { rawText: '', parserVersion: this.version, warnings };
    }
  }

  private async extractDocx(buffer: Buffer, warnings: string[]): Promise<ExtractionResult> {
    try {
      // @ts-expect-error mammoth has no type declarations
      const mammothModule = await import('mammoth');
      const mammoth = mammothModule.default || mammothModule;
      const result = await mammoth.extractRawText({ buffer });

      if (result.messages?.length) {
        for (const msg of result.messages) {
          if (msg.type === 'warning') warnings.push(msg.message);
        }
      }

      const rawText = (result.value as string).trim();
      return { rawText, parserVersion: this.version, warnings };
    } catch (err) {
      warnings.push(`DOCX extraction failed: ${err instanceof Error ? err.message : String(err)}, falling back to UTF-8.`);
      const rawText = buffer.toString('utf-8');
      return { rawText, parserVersion: this.version, warnings };
    }
  }
}

export const documentExtractionService = new DocumentExtractionService();
