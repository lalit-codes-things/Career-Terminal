import type { RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface TimelineEntry {
  entryId: string;
  recruiterId: RecruiterId;
  eventType: string;
  summary: string;
  occurredAt: string;
  confidence: number;
  source: string;
}

export interface TimelineService {
  append(entry: TimelineEntry): Promise<void>;
  list(recruiterId: RecruiterId): Promise<TemporalFact<TimelineEntry>[]>;
}
