/**
 * Email Normalizer
 *
 * Transforms raw, provider-specific email models (GmailMessage) into
 * our provider-agnostic database schema format (Prisma EmailMessage).
 */
import type { GmailMessage } from '../models/gmail.types';

/** The required shape for inserting into the database via Prisma */
export interface NormalizedEmailInput {
  providerMessageId: string;
  threadId: string;
  sender: string;
  recipients: any; // Stored as JSON in DB
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  labels: string[];
  hasAttachments: boolean;
  receivedAt: Date;
}

export class EmailNormalizer {
  /**
   * Normalizes a GmailMessage into the standard database format.
   */
  normalize(message: GmailMessage): NormalizedEmailInput {
    // Ensure text fields are not null if undefined
    const bodyText = message.bodyText ? message.bodyText.trim() : null;
    const bodyHtml = message.bodyHtml ? message.bodyHtml.trim() : null;

    // Truncate subjects if they are pathologically long (DB string limits)
    const subject = message.subject.substring(0, 500);

    return {
      providerMessageId: message.id,
      threadId: message.threadId,
      sender: message.sender || 'Unknown Sender',
      recipients: message.recipients,
      subject,
      bodyText,
      bodyHtml,
      labels: message.labelIds,
      hasAttachments: message.hasAttachments,
      receivedAt: message.receivedAt,
    };
  }

  /**
   * Normalizes an array of messages.
   */
  normalizeBatch(messages: GmailMessage[]): NormalizedEmailInput[] {
    return messages.map((msg) => this.normalize(msg));
  }
}
