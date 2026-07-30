/**
 * CareerPreferences domain contracts.
 *
 * CandidateProfile.preferences is stored as unstructured JSON in the database.
 * These types define the structured schema Career Terminal expects so that
 * preferences can be validated, migrated, and eventually replaced with typed
 * columns without breaking the existing persistence layer.
 */

export interface CareerPreferences {
  readonly targetRoles: readonly string[];
  readonly targetCompanies: readonly string[];
  readonly targetLocations: readonly string[];
  readonly remotePolicy: RemotePolicy | null;
  readonly employmentType: EmploymentType | null;
  readonly compensationExpectation: CompensationExpectation | null;
  readonly visaWorkRequirements: VisaWorkRequirements | null;
  readonly availability: Availability | null;
  readonly careerStage: CareerStage | null;
}

export type RemotePolicy = 'REMOTE' | 'HYBRID' | 'ON_SITE' | 'ANY';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'ANY';
export type CareerStage =
  | 'STUDENT'
  | 'ENTRY_LEVEL'
  | 'MID_LEVEL'
  | 'SENIOR_LEVEL'
  | 'LEAD'
  | 'MANAGER'
  | 'DIRECTOR'
  | 'VP'
  | 'C_LEVEL'
  | 'RETIRED';

export interface CompensationExpectation {
  readonly currency: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly period: 'YEAR' | 'MONTH' | 'HOUR';
}

export interface VisaWorkRequirements {
  readonly requiresSponsorship: boolean;
  readonly workAuthorizations: readonly string[];
}

export interface Availability {
  readonly startDate: string | null;
  readonly noticePeriodWeeks: number | null;
  readonly immediatelyAvailable: boolean;
}

export const EMPTY_CAREER_PREFERENCES: CareerPreferences = {
  targetRoles: [],
  targetCompanies: [],
  targetLocations: [],
  remotePolicy: null,
  employmentType: null,
  compensationExpectation: null,
  visaWorkRequirements: null,
  availability: null,
  careerStage: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceCompensation(raw: unknown): CompensationExpectation | null {
  if (!isRecord(raw)) return null;
  const currency = typeof raw.currency === 'string' ? raw.currency : 'USD';
  const min = typeof raw.min === 'number' ? raw.min : null;
  const max = typeof raw.max === 'number' ? raw.max : null;
  const period = ['YEAR', 'MONTH', 'HOUR'].includes(raw.period as string)
    ? (raw.period as CompensationExpectation['period'])
    : 'YEAR';
  return { currency, min, max, period };
}

function coerceVisaWorkRequirements(raw: unknown): VisaWorkRequirements | null {
  if (!isRecord(raw)) return null;
  const requiresSponsorship = Boolean(raw.requiresSponsorship);
  const workAuthorizations = Array.isArray(raw.workAuthorizations)
    ? raw.workAuthorizations.filter((v): v is string => typeof v === 'string')
    : [];
  return { requiresSponsorship, workAuthorizations };
}

function coerceAvailability(raw: unknown): Availability | null {
  if (!isRecord(raw)) return null;
  const startDate = typeof raw.startDate === 'string' ? raw.startDate : null;
  const noticePeriodWeeks = typeof raw.noticePeriodWeeks === 'number' ? raw.noticePeriodWeeks : null;
  const immediatelyAvailable = Boolean(raw.immediatelyAvailable);
  return { startDate, noticePeriodWeeks, immediatelyAvailable };
}

export function coerceCareerPreferences(
  input: unknown,
): CareerPreferences {
  if (!isRecord(input)) {
    return { ...EMPTY_CAREER_PREFERENCES };
  }

  return {
    targetRoles: Array.isArray(input.targetRoles)
      ? input.targetRoles.filter((v): v is string => typeof v === 'string')
      : [],
    targetCompanies: Array.isArray(input.targetCompanies)
      ? input.targetCompanies.filter((v): v is string => typeof v === 'string')
      : [],
    targetLocations: Array.isArray(input.targetLocations)
      ? input.targetLocations.filter((v): v is string => typeof v === 'string')
      : [],
    remotePolicy: ['REMOTE', 'HYBRID', 'ON_SITE', 'ANY'].includes(input.remotePolicy as string)
      ? (input.remotePolicy as CareerPreferences['remotePolicy'])
      : null,
    employmentType: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'ANY'].includes(
      input.employmentType as string,
    )
      ? (input.employmentType as CareerPreferences['employmentType'])
      : null,
    compensationExpectation: coerceCompensation(input.compensationExpectation),
    visaWorkRequirements: coerceVisaWorkRequirements(input.visaWorkRequirements),
    availability: coerceAvailability(input.availability),
    careerStage: ['STUDENT', 'ENTRY_LEVEL', 'MID_LEVEL', 'SENIOR_LEVEL', 'LEAD', 'MANAGER', 'DIRECTOR', 'VP', 'C_LEVEL', 'RETIRED'].includes(
      input.careerStage as string,
    )
      ? (input.careerStage as CareerPreferences['careerStage'])
      : null,
  };
}
