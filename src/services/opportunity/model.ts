export type RemoteModel = 'on_site' | 'hybrid' | 'remote' | 'flexible';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship' | 'freelance' | 'volunteer';

export interface OpportunityLocation {
  countryCode: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  remoteModel: RemoteModel;
}

export interface OpportunityProvenance {
  provider: string;
  sourceUrl?: string;
  collectedAt: Date;
  rawSignature?: string;
}

export interface OpportunityMetadata {
  [key: string]: any;
}

export interface OpportunityVersion {
  version: number;
  changedAt: Date;
  changedBy: string;
  snapshot: Partial<Opportunity>;
}

export interface Opportunity {
  id: string;
  opportunityTypeId: string;     // Registered type e.g. 'external_job'
  title: string;
  companyId?: string;
  companyName?: string;
  location: OpportunityLocation;
  employmentType: EmploymentType;
  source: string;
  confidence: number;            // 0 to 1
  validFrom: Date;
  validTo?: Date;
  provenance: OpportunityProvenance;
  metadata: OpportunityMetadata;
  currentVersion: number;
  versions: OpportunityVersion[];
  explanation?: string;
}
