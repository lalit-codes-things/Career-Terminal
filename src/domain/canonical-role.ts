/**
 * CanonicalRole domain contracts — Section 8 of the architecture directive.
 *
 * Role titles must eventually be canonicalised. This abstraction supports
 * canonical role names, categories, seniority, synonyms, required skills,
 * preferred skills, salary information, and labour-market demand.
 */

export interface CanonicalRoleInput {
  readonly canonicalName: string;
  readonly category?: string;
  readonly seniority?: string;
  readonly synonyms?: readonly string[];
  readonly requiredSkills?: readonly string[];
  readonly preferredSkills?: readonly string[];
  readonly salaryInfo?: Record<string, unknown>;
  readonly demandTrend?: string;
}

export interface CanonicalRoleRecord {
  readonly id: string;
  readonly canonicalName: string;
  readonly category: string | null;
  readonly seniority: string | null;
  readonly synonyms: readonly string[];
  readonly requiredSkills: readonly string[];
  readonly preferredSkills: readonly string[];
  readonly salaryInfo: Record<string, unknown>;
  readonly demandTrend: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const ROLE_SENIORITY = {
  ENTRY: 'ENTRY',
  MID: 'MID',
  SENIOR: 'SENIOR',
  LEAD: 'LEAD',
  STAFF: 'STAFF',
  PRINCIPAL: 'PRINCIPAL',
  MANAGER: 'MANAGER',
  DIRECTOR: 'DIRECTOR',
  VP: 'VP',
  C_LEVEL: 'C_LEVEL',
} as const;

export type RoleSeniority = (typeof ROLE_SENIORITY)[keyof typeof ROLE_SENIORITY];

export const ROLE_CATEGORIES = {
  ENGINEERING: 'ENGINEERING',
  PRODUCT: 'PRODUCT',
  DESIGN: 'DESIGN',
  DATA: 'DATA',
  MARKETING: 'MARKETING',
  SALES: 'SALES',
  FINANCE: 'FINANCE',
  LEGAL: 'LEGAL',
  OPERATIONS: 'OPERATIONS',
  HUMAN_RESOURCES: 'HUMAN_RESOURCES',
  SUPPORT: 'SUPPORT',
  OTHER: 'OTHER',
} as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[keyof typeof ROLE_CATEGORIES];
