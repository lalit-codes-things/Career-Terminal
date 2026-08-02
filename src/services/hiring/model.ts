export interface HiringSignalEvidence {
  provider: string;
  source: string;
  description: string;
  value: any;
  timestamp: Date;
  confidence: number;
}

export interface HiringSignal {
  companyId: string;
  signalId: string; // The registered signal ID (e.g. 'hiring_growth')
  confidence: number; // Aggregated confidence
  validFrom: Date;
  validTo?: Date;
  evidence: HiringSignalEvidence[];
}
