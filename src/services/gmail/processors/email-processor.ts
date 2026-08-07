import { dbRouter } from '../../../config/database';
import { logger } from '../../../lib/logger';
import {
  jobEmailClassifier,
  JobEmailCategory,
  type ClassifiableEmail,
} from '../../job-intelligence';
import { applicationTrackingService } from '../../application-tracking/application-tracking.service';

export interface EmailProcessor {
  processMessage(messageId: string): Promise<void>;
  processBatch(messageIds: string[]): Promise<void>;
}

export class GmailEmailProcessor implements EmailProcessor {
  async processMessage(messageId: string): Promise<void> {
    const email = await dbRouter.read().emailMessage.findUnique({
      where: { id: messageId },
    });
    if (!email) {
      logger.warn('[GmailEmailProcessor] Email not found', { messageId });
      return;
    }

    const classifiableEmail: ClassifiableEmail = {
      emailId: email.providerMessageId,
      sender: email.from ?? '',
      subject: email.subject ?? '',
      bodyText: email.bodyText ?? undefined,
      bodyHtml: email.bodyHtml ?? undefined,
      receivedAt: email.receivedAt,
      threadId: email.threadId ?? undefined,
    };
    const classification = await jobEmailClassifier.classify(classifiableEmail);
    if (classification.category === JobEmailCategory.NOT_JOB_RELATED) {
      return;
    }

    await applicationTrackingService.processEmailForJobApplication(
      classifiableEmail,
      classification,
      email.legacyUserId ?? '',
    );
  }

  async processBatch(messageIds: string[]): Promise<void> {
    for (const messageId of messageIds) {
      await this.processMessage(messageId);
    }
  }
}
