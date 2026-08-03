export type RecruiterIdentityLifecycleState = 'canonical' | 'historical' | 'merged' | 'retired';
export type RecruiterContactKind = 'email' | 'phone' | 'social' | 'ats' | 'employer' | 'name';
export type VerificationStatus = 'VERIFIED' | 'PENDING' | 'UNVERIFIED' | 'REJECTED';

export interface RecruiterIdentityEvidence {
  source: string;
  sourceId?: string;
  observedAt: Date;
  excerpt?: string;
}

export interface RecruiterIdentityProvenance {
  system: string;
  actor?: string;
  method: 'deterministic' | 'ai_assisted' | 'human_review';
  evidence: RecruiterIdentityEvidence[];
}

export interface RecruiterIdentitySignal {
  kind: RecruiterContactKind;
  value: string;
  provider?: string;
  confidence?: number;
}

export interface RecruiterIdentityProfile {
  id: string;
  canonicalId: string;
  lifecycleState: RecruiterIdentityLifecycleState;
  displayName: string;
  normalizedName: string;
  emails: string[];
  phones: string[];
  socialProfiles: string[];
  employers: string[];
  atsIdentifiers: string[];
  fingerprints: string[];
  confidence: number;
  qualityScore: number;
  verificationStatus: VerificationStatus;
  metadata: Record<string, unknown>;
  provenance: RecruiterIdentityProvenance;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecruiterIdentityInput {
  displayName: string;
  signals?: RecruiterIdentitySignal[];
  lifecycleState?: RecruiterIdentityLifecycleState;
  verificationStatus?: VerificationStatus;
  metadata?: Record<string, unknown>;
  provenance: RecruiterIdentityProvenance;
}
