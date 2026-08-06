/**
 * Document extraction hardening tests (Security 4):
 *   1. DOCX extraction no longer silently falls back to UTF-8 garbage when
 *      mammoth fails — it surfaces a meaningful error.
 *   2. Unsupported MIME types are rejected instead of decoded as UTF-8.
 *   3. Extraction is bounded by a parse timeout so a malicious document
 *      cannot hang the request/worker.
 *   4. Successful DOCX / PDF extraction still returns raw text.
 */
import { DocumentExtractionService } from '../document-extraction.service';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));

jest.mock('pdf-parse', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { extractRawText } from 'mammoth';
import pdfParseDefault from 'pdf-parse';

const service = new DocumentExtractionService();

describe('DocumentExtractionService hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (extractRawText as unknown as jest.Mock).mockResolvedValue({ value: 'Hello DOCX', messages: [] });
    (pdfParseDefault as unknown as jest.Mock).mockResolvedValue({ text: 'Hello PDF', numpages: 1 });
  });

  describe('DOCX — no silent UTF-8 fallback', () => {
    it('throws a meaningful error when mammoth fails instead of returning UTF-8 garbage', async () => {
      (extractRawText as unknown as jest.Mock).mockRejectedValue(new Error('corrupt zip'));

      await expect(
        service.extract(Buffer.from('\x50\x4b\x03\x04 not a real docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ).rejects.toThrow('DOCX extraction failed: corrupt zip');
    });

    it('returns extracted text on success', async () => {
      const result = await service.extract(
        Buffer.from('PK\x03\x04 fake docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(result.rawText).toBe('Hello DOCX');
    });
  });

  describe('Unsupported MIME rejection', () => {
    it('rejects unsupported MIME types instead of decoding as UTF-8', async () => {
      await expect(service.extract(Buffer.from('garbage'), 'application/octet-stream')).rejects.toThrow(
        "Unsupported document MIME type 'application/octet-stream'",
      );
    });
  });

  describe('Parse timeout', () => {
    it('fails fast when extraction exceeds the timeout', async () => {
      (extractRawText as unknown as jest.Mock).mockImplementation(
        () => new Promise((_resolve) => setTimeout(_resolve, 5000)),
      );

      await expect(
        service.extract(
          Buffer.from('PK\x03\x04 fake docx'),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          50,
        ),
      ).rejects.toThrow('DOCX extraction timed out');
    });

    it('respects the default timeout when none is provided', async () => {
      jest.useFakeTimers();
      try {
        (pdfParseDefault as unknown as jest.Mock).mockImplementation(
          () => new Promise(() => {}), // never resolves
        );

        const promise = service.extract(Buffer.from('%PDF-1.4'), 'application/pdf');
        const assertion = expect(promise).rejects.toThrow('PDF extraction timed out');

        // The service default is 15s; ensure the timer was scheduled with it.
        await jest.advanceTimersByTimeAsync(16_000);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
    });

    it('clears the timer after a successful extraction', async () => {
      const spy = jest.spyOn(global, 'setTimeout');
      const result = await service.extract(Buffer.from('%PDF-1.4'), 'application/pdf');
      expect(result.rawText).toBe('Hello PDF');
      spy.mockRestore();
    });
  });

  describe('PDF still works', () => {
    it('returns extracted text on success', async () => {
      const result = await service.extract(Buffer.from('%PDF-1.4'), 'application/pdf');
      expect(result.rawText).toBe('Hello PDF');
    });
  });
});
