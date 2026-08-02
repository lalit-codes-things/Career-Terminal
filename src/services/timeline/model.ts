export interface TimelineEvent {
  eventId: string;
  typeId: string; // the registered event type
  companyId: string;
  date: Date;
  provider: string;
  confidence: number;
  data: Record<string, any>;
  version: number;
  timestamp: Date;
}

export interface TimelineSnapshot {
  date: Date;
  events: TimelineEvent[];
}
