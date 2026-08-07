import { logger } from '../../lib/logger';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

export interface IEmailProvider {
  send(options: SendEmailOptions): Promise<void>;
}

export class MockEmailProvider implements IEmailProvider {
  async send(options: SendEmailOptions): Promise<void> {
    logger.info('[MockEmailProvider] Email intercepted', {
      to: options.to,
      subject: options.subject,
      hasHtml: !!options.bodyHtml,
      bodyTextPreview: options.bodyText.slice(0, 80),
    });
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Default export acts as the current active provider. In a real environment,
// this would be determined by configuration (e.g., SendGrid, SES).
export const emailProvider: IEmailProvider = new MockEmailProvider();
