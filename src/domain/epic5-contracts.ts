export type Epic5EntityType = 'COMPANY' | 'OPPORTUNITY';
export type Epic5ObservationKind = 'OBSERVED_FACT' | 'INFERENCE' | 'SIGNAL';
export type Epic5ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type Epic5SourceRecordStatus = 'ACTIVE' | 'SUPERSEDED' | 'RETRACTED' | 'INVALIDATED';

export interface CompanyIdentifierContractInput {
  readonly identifierType: string;
  readonly value: string;
}

export interface SourceRecordContractInput {
  readonly sourceId: string;
  readonly externalRecordId: string;
  readonly observedAt?: Date;
  readonly publishedAt?: Date | null;
  readonly retrievedAt?: Date | null;
  readonly sourceVersion?: string | null;
  readonly sourceUrl?: string | null;
  readonly contentHash?: string | null;
  readonly rawReference?: string | null;
  readonly status?: Epic5SourceRecordStatus;
}

export interface EntityObservationContractInput {
  readonly entityType: Epic5EntityType;
  readonly companyId?: string | null;
  readonly opportunityId?: string | null;
  readonly sourceId: string;
  readonly provenanceId?: string | null;
  readonly observedAt?: Date;
  readonly effectiveAt?: Date | null;
  readonly observationType: string;
  readonly observationKind: Epic5ObservationKind;
  readonly observationValue?: unknown;
  readonly confidenceLevel?: Epic5ConfidenceLevel;
  readonly confidenceBasis?: string | null;
  readonly supersedesObservationId?: string | null;
  readonly correctsObservationId?: string | null;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCompanyIdentifierValue(
  identifierType: string,
  value: string,
): string {
  const normalizedType = compact(identifierType).toUpperCase();
  const normalizedValue = compact(value);

  if (normalizedType === 'SEC_CIK') {
    return normalizedValue.replace(/\D+/g, '').padStart(10, '0');
  }

  if (normalizedType === 'UK_COMPANIES_HOUSE_NUMBER') {
    return normalizedValue.toUpperCase().replace(/\s+/g, '');
  }

  if (normalizedType === 'MCA_CIN') {
    return normalizedValue.toUpperCase().replace(/\s+/g, '');
  }

  if (normalizedType === 'DOMAIN') {
    return normalizedValue.toLowerCase();
  }

  return normalizedValue.toLowerCase();
}

export function buildCompanyIdentifierContract(input: CompanyIdentifierContractInput): {
  readonly identifierType: string;
  readonly value: string;
  readonly normalizedValue: string;
} {
  const identifierType = compact(input.identifierType);
  const value = compact(input.value);

  if (!identifierType) {
    throw new Error('identifierType is required');
  }

  if (!value) {
    throw new Error('value is required');
  }

  return {
    identifierType,
    value,
    normalizedValue: normalizeCompanyIdentifierValue(identifierType, value),
  };
}

export function buildSourceScopedRecordKey(sourceId: string, externalRecordId: string): string {
  const left = compact(sourceId);
  const right = compact(externalRecordId);

  if (!left) {
    throw new Error('sourceId is required');
  }

  if (!right) {
    throw new Error('externalRecordId is required');
  }

  return `${left}::${right}`;
}

export function buildSourceRecordContract(input: SourceRecordContractInput) {
  return {
    sourceId: compact(input.sourceId),
    externalRecordId: compact(input.externalRecordId),
    observedAt: input.observedAt ?? new Date(),
    publishedAt: input.publishedAt ?? null,
    retrievedAt: input.retrievedAt ?? null,
    sourceVersion: input.sourceVersion ?? null,
    sourceUrl: input.sourceUrl ?? null,
    contentHash: input.contentHash ?? null,
    rawReference: input.rawReference ?? null,
    status: input.status ?? 'ACTIVE',
    sourceScopedKey: buildSourceScopedRecordKey(input.sourceId, input.externalRecordId),
  };
}

export function buildEntityObservationContract(input: EntityObservationContractInput) {
  if (input.observationKind !== 'OBSERVED_FACT' &&
      input.observationKind !== 'INFERENCE' &&
      input.observationKind !== 'SIGNAL') {
    throw new Error('prediction semantics are not allowed in the Epic 5 foundation');
  }

  const companyId = input.companyId ?? null;
  const opportunityId = input.opportunityId ?? null;
  const observedAt = input.observedAt ?? new Date();

  if (input.entityType === 'COMPANY') {
    if (!companyId || opportunityId) {
      throw new Error('COMPANY observations require companyId and must not include opportunityId');
    }
  } else {
    if (!opportunityId || companyId) {
      throw new Error(
        'OPPORTUNITY observations require opportunityId and must not include companyId',
      );
    }
  }

  if (!compact(input.sourceId)) {
    throw new Error('sourceId is required');
  }

  if (!compact(input.observationType)) {
    throw new Error('observationType is required');
  }

  if (input.supersedesObservationId && input.correctsObservationId &&
      input.supersedesObservationId === input.correctsObservationId) {
    throw new Error('supersedesObservationId and correctsObservationId must reference different observations');
  }

  return {
    entityType: input.entityType,
    entityId: input.entityType === 'COMPANY' ? companyId! : opportunityId!,
    companyId,
    opportunityId,
    sourceId: compact(input.sourceId),
    provenanceId: input.provenanceId ?? null,
    observedAt,
    effectiveAt: input.effectiveAt ?? null,
    observationType: compact(input.observationType),
    observationKind: input.observationKind,
    observationValue: input.observationValue ?? null,
    confidenceLevel: input.confidenceLevel ?? 'UNKNOWN',
    confidenceBasis: input.confidenceBasis ?? null,
    supersedesObservationId: input.supersedesObservationId ?? null,
    correctsObservationId: input.correctsObservationId ?? null,
  };
}
