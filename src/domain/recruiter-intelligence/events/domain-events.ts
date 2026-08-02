export type RecruiterDomainEventName =
  | 'Recruiter.IdentityResolved'
  | 'Recruiter.KnowledgeGraphUpdated'
  | 'Recruiter.CommunicationIndexed'
  | 'Recruiter.RelationshipChanged'
  | 'Recruiter.MemoryUpdated'
  | 'Recruiter.TimelineExtended'
  | 'Recruiter.OrganizationIntelligenceUpdated';

export interface DomainEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  eventVersion: number;
  eventName: RecruiterDomainEventName;
  occurredAt: string;
  aggregateId: string;
  aggregateType: string;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
}

export interface Command<TPayload = Record<string, unknown>> {
  commandId: string;
  commandName: string;
  issuedAt: string;
  correlationId?: string;
  payload: TPayload;
}
