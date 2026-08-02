export enum ApplicationSourceProvider {
  GMAIL = 'GMAIL',
  MANUAL = 'MANUAL',
  OUTLOOK = 'OUTLOOK',
  CSV = 'CSV',
  API = 'API',
}

export interface ApplicationSourceMetadata {
  readonly [key: string]: unknown;
}

export interface ApplicationSourceInput {
  readonly applicationId: string;
  readonly provider: ApplicationSourceProvider;
  readonly providerMessageId?: string | null;
  readonly providerThreadId?: string | null;
  readonly providerConversationId?: string | null;
  readonly providerMetadata?: ApplicationSourceMetadata | null;
  readonly createdAt?: Date;
}
