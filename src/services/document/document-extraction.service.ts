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
  private readonly defaultParseTimeoutMs = 15_000;

  getVersion(): string {
    return this.version;
  }

  async extract(buffer: Buffer, mimetype: string, timeoutMs?: number): Promise<ExtractionResult> {
    const warnings: string[] = [];
    const timeout = timeoutMs ?? this.defaultParseTimeoutMs;

    if (mimetype === 'application/pdf') {
      return this.withTimeout(this.extractPdf(buffer, warnings), timeout, 'PDF extraction timed out');
    }

    if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/msword'
    ) {
      return this.withTimeout(this.extractDocx(buffer), timeout, 'DOCX extraction timed out');
    }

    if (mimetype === 'text/plain' || mimetype === 'text/markdown') {
      const rawText = buffer.toString('utf-8');
      return { rawText, parserVersion: this.version, warnings };
    }

    throw new Error(`Unsupported document MIME type '${mimetype}'`);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

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
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes('timed out')) throw err;
      warnings.push(`PDF extraction failed: ${detail}`);
      return { rawText: '', parserVersion: this.version, warnings };
    }
  }

  private async extractDocx(buffer: Buffer): Promise<ExtractionResult> {
    let result: { value: string; messages: Array<{ type: string; message: string }> };
    try {
      // mammoth ships with its own type declarations since v1.12.
      const mammoth = await import('mammoth');
      result = await mammoth.extractRawText({ buffer });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Do NOT silently fall back to UTF-8: a binary DOCX decoded as UTF-8
      // produces garbage text and hides the real failure. Surface the error.
      throw new Error(`DOCX extraction failed: ${detail}`);
    }

    const warnings: string[] = [];
    if (result.messages?.length) {
      for (const msg of result.messages) {
        if (msg.type === 'warning') warnings.push(msg.message);
      }
    }

    const rawText = result.value.trim();
    return { rawText, parserVersion: this.version, warnings };
  }
}

export const documentExtractionService = new DocumentExtractionService();
