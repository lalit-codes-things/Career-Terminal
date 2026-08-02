export interface RecruiterCreateInput {
  canonicalName: string;
  companyId?: string;
  source: string;
  confidence?: number;
  verificationStatus?: 'verified' | 'pending' | 'unverified' | 'rejected';
}

export interface RecruiterAliasInput {
  alias: string;
  normalizedAlias: string;
  source: string;
  confidence?: number;
  verificationStatus?: 'verified' | 'pending' | 'unverified' | 'rejected';
}

export interface RecruiterValidationResult {
  isValid: boolean;
  errors: string[];
}
