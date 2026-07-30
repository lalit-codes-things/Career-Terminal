/**
 * Opportunity domain contracts — Career Intelligence Layer.
 *
 * Represents the canonical opportunity entity and its immutable
 * observation history.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity Observation
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunityObservationInput {
  readonly opportunityId: string;
  readonly userId?: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly extractionRunId?: string;
  readonly observedAt?: Date;
  readonly title?: string;
  readonly description?: string;
  readonly location?: string;
  readonly compensation?: Record<string, unknown>;
  readonly requirements?: readonly string[];
  readonly department?: string;
  readonly employmentType?: string;
  readonly remotePolicy?: string;
  readonly seniority?: string;
  readonly hiringInfo?: Record<string, unknown>;
  readonly confidence?: number;
  readonly url?: string;
}

export interface OpportunityObservationRecord {
  readonly id: string;
  readonly opportunityId: string;
  readonly userId: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly extractionRunId: string | null;
  readonly observedAt: Date;
  readonly title: string | null;
  readonly description: string | null;
  readonly location: string | null;
  readonly compensation: Record<string, unknown> | null;
  readonly requirements: readonly string[];
  readonly department: string | null;
  readonly employmentType: string | null;
  readonly remotePolicy: string | null;
  readonly seniority: string | null;
  readonly hiringInfo: Record<string, unknown>;
  readonly confidence: number;
  readonly url: string | null;
  readonly isCurrent: boolean;
  readonly supersededById: string | null;
  readonly supersededAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Opportunity
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalOpportunity {
  readonly id: string;
  readonly companyId: string;
  readonly externalId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly salaryRange: string | null;
  readonly employmentType: string | null;
  readonly workSetting: string | null;
  readonly url: string | null;
  readonly requirements: readonly string[];
  readonly sourceMetadata: Record<string, unknown> | null;
  readonly postedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly firstSeenAt: Date | null;
  readonly lastSeenAt: Date | null;
  readonly isCurrent: boolean;
  readonly careersPageUrl: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OpportunityResolutionInput {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly location?: string;
  readonly url?: string;
  readonly description?: string;
  readonly salaryRange?: { readonly min: number; readonly max: number; readonly currency: string };
  readonly requirements?: readonly string[];
  readonly sourceEmailId?: string;
  readonly companyDomain?: string;
  readonly sourceMetadata?: Record<string, unknown>;
}

export interface OpportunityResolutionResult {
  readonly opportunityId: string;
  readonly isNew: boolean;
}
