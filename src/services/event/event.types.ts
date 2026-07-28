// Event types
export const EVENT_TYPES = {
  RESUME_UPLOADED: 'RESUME_UPLOADED',
  RESUME_CLEANED: 'RESUME_CLEANED',
  RESUME_PARSED: 'RESUME_PARSED',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface CreateEventInput {
  eventType: EventType;
  aggregateId: string;
  aggregateType: string;
  userId: string;
  cellId: string;
  payload: Record<string, any>;
  correlationId?: string;
}
