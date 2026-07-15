/**
 * Email Parser Data Models
 */

export interface AttachmentMetadata {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface NormalizedEmail {
  id: string;
  sender: string;
  recipients: {
    to: string[];
    cc: string[];
    bcc: string[];
  };
  subject: string;
  textContent: string | null;
  htmlContent: string | null;
  attachments: AttachmentMetadata[];
  labels: string[];
  timestamp: Date;
}
