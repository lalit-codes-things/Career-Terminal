export interface HealthEvidence {
  source: string;
  description: string;
  value: any;
  timestamp: Date;
}

export interface HealthIndicatorResult {
  id: string; // The indicator ID (e.g. 'financial_health')
  score: number; // 0 to 100
  confidence: number; // 0 to 1
  evidence: HealthEvidence[];
  sources: string[];
  calculationVersion: string;
  timestamp: Date;
}

export interface CompanyHealthProfile {
  companyId: string;
  indicators: HealthIndicatorResult[];
  overallScore: number;
  calculatedAt: Date;
}
