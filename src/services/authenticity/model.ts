export interface AuthenticityEvidence {
  ruleId: string;
  source: string;
  passed: boolean;
  details: string;
}

export interface AuthenticityRiskIndicator {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface CompanyAuthenticityResult {
  companyId: string;
  trustScore: number; // 0 to 100
  confidence: number; // 0 to 1
  riskIndicators: AuthenticityRiskIndicator[];
  evidence: AuthenticityEvidence[];
  explanation: string;
  timestamp: Date;
}
