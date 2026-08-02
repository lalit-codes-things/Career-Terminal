/**
 * Company provider capability model.
 *
 * A *data capability* describes a category of company data a provider can
 * source. Capabilities are coarse, provider-agnostic descriptors used by the
 * registry/discovery layer (and a future capability catalog) — they never
 * dictate *how* a provider fetches data. Providers advertise the capabilities
 * they cover via `ProviderCapabilities.dataCapabilities`; the pipeline treats
 * the list as metadata, not as an execution contract.
 */

export type CompanyDataCapability =
  | 'company_profile'
  | 'identifiers'
  | 'addresses'
  | 'industry_classifications'
  | 'exchange_listings'
  | 'financial_data'
  | 'officers'
  | 'filing_history'
  | 'ownership'
  | 'employment'
  | 'job_listings';

export const COMPANY_DATA_CAPABILITIES: readonly CompanyDataCapability[] = [
  'company_profile',
  'identifiers',
  'addresses',
  'industry_classifications',
  'exchange_listings',
  'financial_data',
  'officers',
  'filing_history',
  'ownership',
  'employment',
  'job_listings',
];

export interface DataCapabilityDetail {
  capability: CompanyDataCapability;
  label: string;
  description: string;
}

const CAPABILITY_DETAILS: Record<CompanyDataCapability, DataCapabilityDetail> = {
  company_profile: {
    capability: 'company_profile',
    label: 'Company Profile',
    description: 'Core identity fields: name, legal name, jurisdiction, status, dates.',
  },
  identifiers: {
    capability: 'identifiers',
    label: 'Identifiers',
    description: 'Registrar-issued identifiers such as company number, CIN, CIK, LEI, EIN.',
  },
  addresses: {
    capability: 'addresses',
    label: 'Addresses',
    description: 'Registered and business addresses with locality, region and postal code.',
  },
  industry_classifications: {
    capability: 'industry_classifications',
    label: 'Industry Classification',
    description: 'Industry codes and labels such as SIC, NAICS or ISIC.',
  },
  exchange_listings: {
    capability: 'exchange_listings',
    label: 'Exchange Listings',
    description: 'Stock exchange listings, tickers and primary-listing flags.',
  },
  financial_data: {
    capability: 'financial_data',
    label: 'Financial Data',
    description: 'Financial metrics derived from regulatory filings (no analytics performed here).',
  },
  officers: {
    capability: 'officers',
    label: 'Officers',
    description: 'Directors and officers associated with the company.',
  },
  filing_history: {
    capability: 'filing_history',
    label: 'Filing History',
    description: 'Regulatory filings and their history.',
  },
  ownership: {
    capability: 'ownership',
    label: 'Ownership',
    description: 'Ownership structure and significant shareholders.',
  },
  employment: {
    capability: 'employment',
    label: 'Employment',
    description: 'Headcount and employment information.',
  },
  job_listings: {
    capability: 'job_listings',
    label: 'Job Listings',
    description: 'Open job postings (raw listing data only).',
  },
};

export function describeCapability(capability: CompanyDataCapability): DataCapabilityDetail {
  return CAPABILITY_DETAILS[capability];
}

export function capabilityLabel(capability: CompanyDataCapability): string {
  return CAPABILITY_DETAILS[capability].label;
}

export function isCompanyDataCapability(value: unknown): value is CompanyDataCapability {
  return (
    typeof value === 'string' &&
    (COMPANY_DATA_CAPABILITIES as readonly unknown[]).includes(value)
  );
}

/** Whether a provider's advertised capability list covers the given capability. */
export function hasCapability(
  dataCapabilities: readonly CompanyDataCapability[] | null | undefined,
  capability: CompanyDataCapability,
): boolean {
  return dataCapabilities?.includes(capability) ?? false;
}
