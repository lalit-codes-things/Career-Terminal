jest.mock('sanitize-html', () => {
  const DANGEROUS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);

  function sanitizeHtml(html: string, options?: { allowedTags?: string[]; allowedAttributes?: Record<string, string[]>; allowedSchemes?: string[] }): string {
    if (typeof html !== 'string') return '';

    const allowedTags = options?.allowedTags ?? [];
    const allowedAttributes = options?.allowedAttributes ?? {};
    const allowedSchemes = options?.allowedSchemes ?? [];

    if (allowedTags.length === 0) {
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(?:p|div|tr|li|h[1-6]|blockquote|pre|table)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    }

    let result = html;
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    const tags = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(html)) !== null) {
      if (match[1]) {
        tags.add(match[1].toLowerCase());
      }
    }

    for (const tag of tags) {
      if (!allowedTags.includes(tag)) {
        if (DANGEROUS_TAGS.has(tag)) {
          const openRegex = new RegExp(`<${tag}[^>]*>(?:[\\s\\S]*?)<\\/${tag}>`, 'gi');
          const selfCloseRegex = new RegExp(`<${tag}[^>]*\\/>`, 'gi');
          result = result.replace(openRegex, '').replace(selfCloseRegex, '');
        } else {
          const openRegex = new RegExp(`<${tag}[^>]*>`, 'gi');
          const closeRegex = new RegExp(`</${tag}>`, 'gi');
          result = result.replace(openRegex, '').replace(closeRegex, '');
        }
      } else {
        const attrRegex = new RegExp(`<${tag}([^>]*)>`, 'gi');
        result = result.replace(attrRegex, (_match: string, attrs: string): string => {
          const cleanedAttrs = attrs.replace(/\s+(on\w+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '').replace(/\s+/g, ' ').trim();
          const tagAllowedAttrs = allowedAttributes[tag] ? allowedAttributes[tag] : [];
          const filteredAttrs = cleanedAttrs.split(/\s+/).filter((attr: string) => {
            if (!attr.includes('=')) return false;
            const name = attr.split('=')[0]!;
            if (!tagAllowedAttrs.includes(name)) return false;
            if (name === 'href' || name === 'src') {
              const valueMatch = attr.match(/=(?:"([^"]*)"|'[^']*'|[^\s>]*)/);
              const value = valueMatch ? (valueMatch[1] || valueMatch[2] || valueMatch[3] || '') : '';
              if (allowedSchemes.length > 0) {
                try {
                  const parsed = new URL(value);
                  if (!allowedSchemes.includes(parsed.protocol.replace(':', ''))) return false;
                } catch {
                  return false;
                }
              }
              if (value.startsWith('javascript:') || value.startsWith('data:')) return false;
            }
            return true;
          }).join(' ');
          return `<${tag}${filteredAttrs ? ' ' + filteredAttrs : ''}>`;
        });
      }
    }

    return result;
  }

  return sanitizeHtml;
});

import { EmailParserService } from '../services/gmail/processors/email-parser.service';

// Define local types matching the gmail_v1 schema shapes used in tests
// (The googleapis shim exports gmail_v1 as `type = any`, not a usable namespace)
interface GmailMessageHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
}

describe('EmailParserService', () => {
  let parser: EmailParserService;

  beforeEach(() => {
    parser = new EmailParserService();
  });

  const encodeBase64Url = (str: string): string =>
    Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  it('should parse headers correctly', () => {
    const raw: GmailMessage = {
      id: 'msg-1',
      labelIds: ['INBOX', 'UNREAD'],
      payload: {
        headers: [
          { name: 'From', value: 'sender@example.com' },
          { name: 'To', value: 'to1@test.com, to2@test.com' },
          { name: 'Subject', value: 'Test Subject' },
          { name: 'Date', value: 'Mon, 10 Jan 2022 10:00:00 +0000' },
        ],
      },
    };

    const result = parser.parse(raw);

    expect(result.id).toBe('msg-1');
    expect(result.sender).toBe('sender@example.com');
    expect(result.recipients.to).toEqual(['to1@test.com', 'to2@test.com']);
    expect(result.subject).toBe('Test Subject');
    expect(result.timestamp.toISOString()).toBe(new Date('2022-01-10T10:00:00.000Z').toISOString());
    expect(result.labels).toEqual(['INBOX', 'UNREAD']);
  });

  it('should extract plaintext body when present', () => {
    const raw: GmailMessage = {
      id: 'msg-1',
      payload: {
        mimeType: 'text/plain',
        body: { data: encodeBase64Url('Hello World') },
      },
    };

    const result = parser.parse(raw);
    expect(result.textContent).toBe('Hello World');
    expect(result.htmlContent).toBeNull();
  });

  it('should fallback to stripping HTML when plaintext is absent', () => {
    const raw: GmailMessage = {
      id: 'msg-1',
      payload: {
        mimeType: 'text/html',
        body: {
          data: encodeBase64Url(
            '<html><body><h1>Title</h1><p>Hello <b>World</b>!</p><br>Footer</body></html>',
          ),
        },
      },
    };

    const result = parser.parse(raw);
    expect(result.htmlContent).toContain('<h1>Title</h1>');

    expect(result.textContent).toContain('Title');
    expect(result.textContent).toContain('Hello World!');
    expect(result.textContent).toContain('Footer');
  });

  it('should traverse multipart/mixed payloads and extract attachments', () => {
    const raw: GmailMessage = {
      id: 'msg-1',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: encodeBase64Url('Plain part') },
              },
              {
                mimeType: 'text/html',
                body: { data: encodeBase64Url('<b>HTML part</b>') },
              },
            ],
          },
          {
            mimeType: 'application/pdf',
            filename: 'document.pdf',
            body: { attachmentId: 'attach-1', size: 1024 },
          },
        ],
      },
    };

    const result = parser.parse(raw);
    expect(result.textContent).toBe('Plain part');
    expect(result.htmlContent).toBe('<b>HTML part</b>');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      attachmentId: 'attach-1',
    });
  });

  it('should handle missing payload gracefully', () => {
    const raw: GmailMessage = {
      id: 'msg-empty',
      // No payload
    };

    const result = parser.parse(raw);
    expect(result.textContent).toBeNull();
    expect(result.htmlContent).toBeNull();
    expect(result.attachments).toHaveLength(0);
  });

  it('should prevent infinite recursion on extremely nested parts', () => {
    // Construct a deeply nested object > 20 levels
    let currentPart: GmailMessagePart = {
      mimeType: 'text/plain',
      body: { data: encodeBase64Url('Deep text') },
    };

    for (let i = 0; i < 25; i++) {
      currentPart = {
        mimeType: 'multipart/mixed',
        parts: [currentPart],
      };
    }

    const raw: GmailMessage = {
      id: 'msg-deep',
      payload: currentPart,
    };

    const result = parser.parse(raw);

    // Because it stops at depth 20, it should not find the 'Deep text'
    expect(result.textContent).toBeNull();
  });

  it('should sanitize HTML with production options', () => {
    const raw: GmailMessage = {
      id: 'msg-sanitize',
      payload: {
        mimeType: 'text/html',
        body: {
          data: encodeBase64Url(
            '<p>Safe</p><script>alert("xss")</script><a href="javascript:alert(1)">click</a><img src="https://example.com/x" onclick="evil()">',
          ),
        },
      },
    };

    const result = parser.parse(raw);
    expect(result.htmlContent).toBe('<p>Safe</p><a>click</a>');
    expect(result.textContent).toBe('Safe\nalert("xss")click');
  });
});
