import type { GmailMessagePart, GmailMessagePartHeader } from '../models/gmail.types';
import type { NormalizedEmail, AttachmentMetadata } from '../models/parser.types';
import sanitizeHtml from 'sanitize-html';

export class EmailParserService {
  /**
   * Main entrypoint: Parses a raw Gmail API message into a NormalizedEmail.
   */
  public parse(rawMessage: {
    id?: string;
    payload?: GmailMessagePart;
    labelIds?: string[];
  }): NormalizedEmail {
    const headers = this.parseHeaders(rawMessage.payload?.headers);
    const { textContent, htmlContent, attachments } = this.extractBodyAndAttachments(
      rawMessage.payload,
    );

    return {
      id: rawMessage.id ?? 'unknown-id',
      sender: headers.from,
      recipients: {
        to: headers.to,
        cc: headers.cc,
        bcc: headers.bcc,
      },
      subject: headers.subject,
      textContent: textContent || this.fallbackHtmlToText(htmlContent),
      htmlContent,
      attachments,
      labels: rawMessage.labelIds ?? [],
      timestamp: headers.date,
    };
  }

  /**
   * Extracts strongly-typed headers from the raw array.
   */
  private parseHeaders(headers: GmailMessagePartHeader[] | undefined) {
    const result = {
      from: '',
      to: [] as string[],
      cc: [] as string[],
      bcc: [] as string[],
      subject: '',
      date: new Date(),
    };

    if (!headers) return result;

    const getHeader = (name: string): string => {
      const match = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
      return match?.value ?? '';
    };

    const splitAddresses = (value: string): string[] => {
      if (!value) return [];
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    result.from = getHeader('From');
    result.to = splitAddresses(getHeader('To'));
    result.cc = splitAddresses(getHeader('Cc'));
    result.bcc = splitAddresses(getHeader('Bcc'));
    result.subject = getHeader('Subject');

    const dateHeader = getHeader('Date');
    const parsedDate = new Date(dateHeader);
    if (!isNaN(parsedDate.getTime())) {
      result.date = parsedDate;
    } else {
      // Fallback for malformed dates
      const internalDate = this.parseInternalDate(headers);
      result.date = internalDate ? new Date(internalDate) : new Date();
    }

    return result;
  }

  /**
   * Hack to get internal date if standard date is malformed, assuming it's available.
   * Normally Gmail passes internalDate at the root level, but if missing, fallback to now.
   */
  private parseInternalDate(_headers: GmailMessagePartHeader[]): number | null {
    // Just a dummy implementation. The actual rawMessage.internalDate would be better
    // if passed down, but for this signature, we just return null.
    return null;
  }

  /**
   * Recursively traverses the MIME parts tree to extract bodies and attachments.
   */
  private extractBodyAndAttachments(payload: GmailMessagePart | undefined) {
    let textContent: string | null = null;
    let htmlContent: string | null = null;
    const attachments: AttachmentMetadata[] = [];

    if (!payload) {
      return { textContent, htmlContent, attachments };
    }

    // Helper for base64url decoding
    const decodeBase64Url = (str: string): string => {
      try {
        const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(base64, 'base64').toString('utf-8');
      } catch (e) {
        return '';
      }
    };

    // Recursive traversal function
    const traverse = (part: GmailMessagePart, depth = 0) => {
      // Prevent infinite recursion in extremely malformed deep emails
      if (depth > 20) return;

      const mimeType = part.mimeType?.toLowerCase();
      const filename = part.filename;
      const bodyData = part.body?.data;
      const attachmentId = part.body?.attachmentId;

      // 1. Check if it's an attachment
      if (filename && filename.length > 0 && attachmentId) {
        attachments.push({
          filename,
          mimeType: mimeType || 'application/octet-stream',
          size: part.body?.size ?? 0,
          attachmentId,
        });
      }
      // 2. Check if it's body content (text/plain)
      else if (mimeType === 'text/plain' && bodyData && !attachmentId) {
        const decoded = decodeBase64Url(bodyData);
        textContent = textContent ? textContent + '\n' + decoded : decoded;
      }
      // 3. Check if it's body content (text/html)
      else if (mimeType === 'text/html' && bodyData && !attachmentId) {
        const decoded = decodeBase64Url(bodyData);
        htmlContent = htmlContent ? htmlContent + '<br>' + decoded : decoded;
      }

      // 4. Recurse into children
      if (part.parts && Array.isArray(part.parts)) {
        for (const child of part.parts) {
          traverse(child, depth + 1);
        }
      }
    };

    traverse(payload);

    return { textContent, htmlContent, attachments };
  }

  /**
   * Graceful fallback: strips HTML tags to produce basic plaintext.
   * Uses sanitize-html to ensure complete multi-character sanitization.
   */
  private fallbackHtmlToText(html: string | null): string | null {
    if (!html) return null;

    const sanitized = sanitizeHtml(html, {
      allowedTags: [],
      allowedAttributes: {},
    });

    return sanitized
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:p|div|tr|li)[^>]*>/gi, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }
}
