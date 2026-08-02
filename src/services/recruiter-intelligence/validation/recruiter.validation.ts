import { z } from 'zod';
import type { RecruiterCreateInput, RecruiterAliasInput, RecruiterValidationResult } from '../domain/recruiter-data.types';

const recruiterCreateSchema = z.object({
  canonicalName: z.string().trim().min(1),
  companyId: z.string().uuid().optional(),
  source: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  verificationStatus: z.enum(['verified', 'pending', 'unverified', 'rejected']).optional(),
});

const recruiterAliasSchema = z.object({
  alias: z.string().trim().min(1),
  normalizedAlias: z.string().trim().min(1),
  source: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  verificationStatus: z.enum(['verified', 'pending', 'unverified', 'rejected']).optional(),
});

export function validateRecruiterCreate(input: RecruiterCreateInput): RecruiterValidationResult {
  const parsed = recruiterCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { isValid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }
  return { isValid: true, errors: [] };
}

export function validateRecruiterAlias(input: RecruiterAliasInput): RecruiterValidationResult {
  const parsed = recruiterAliasSchema.safeParse(input);
  if (!parsed.success) {
    return { isValid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }
  return { isValid: true, errors: [] };
}
