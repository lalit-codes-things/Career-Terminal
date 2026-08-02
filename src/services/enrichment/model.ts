export interface EnrichmentRecord {
  provider: string;
  category: string;
  attribute: string;
  value: any;
  confidence: number;
  version: string;
  source: string;
  metadata?: Record<string, any>;
  validFrom: Date;
  validTo?: Date;
}
