import type { EvidenceRef, RecruiterId } from '../../../domain/recruiter-intelligence/shared-kernel/types';

export interface RecruiterIntelligenceRepositoryPort<T> {
  save(entity: T): Promise<void>;
  findById(id: string): Promise<T | null>;
  listForRecruiter(recruiterId: RecruiterId): Promise<T[]>;
}

export interface RecruiterIntelligenceEventBus {
  publish(eventName: string, payload: Record<string, unknown>): Promise<void>;
}

export interface RecruiterIntelligenceQueuePort {
  enqueue(jobName: string, payload: Record<string, unknown>): Promise<string>;
}

export interface RecruiterIntelligenceStoragePort {
  storeBlob(key: string, bytes: Uint8Array): Promise<string>;
  fetchBlob(key: string): Promise<Uint8Array>;
}

export interface RecruiterIntelligenceSecurityContext {
  tenantId: RecruiterId;
  region: string;
  consentState: 'granted' | 'denied' | 'unknown';
  evidence: EvidenceRef[];
}
