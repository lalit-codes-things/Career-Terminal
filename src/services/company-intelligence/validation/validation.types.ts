/**
 * Validation types for the company import pipeline.
 */

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Field path the issue relates to, e.g. 'identifiers[0].value'. */
  field: string;
  /** Stable machine-readable code, e.g. 'MISSING_NAME'. */
  code: string;
  message: string;
}

export interface ValidationReport {
  /** True when there are no blocking errors. */
  valid: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
  issues: ValidationIssue[];
}

export const EMPTY_VALIDATION_REPORT: ValidationReport = {
  valid: true,
  hasErrors: false,
  hasWarnings: false,
  issues: [],
};
