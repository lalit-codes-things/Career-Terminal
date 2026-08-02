/**
 * Company Intelligence API v1 — canonical request/response types.
 *
 * Every response is wrapped in a standard envelope that includes:
 *   - data         — the payload
 *   - metadata     — processing metadata (latency, request id, …)
 *   - provenance   — which data sources contributed
 *   - timestamp    — response generation time (ISO-8601)
 *   - version      — API version string
 *   - pagination   — present whenever the endpoint pages results
 *
 * No provider-specific field names ever appear in these types.
 * Future GraphQL compatibility: each handler returns the same typed
 * objects — a GraphQL resolver can call a handler and map the envelope.
 */

// ── Shared pagination ────────────────────────────────────────────────────────

export interface PagePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface CursorPagination {
  cursor: string | null;
  nextCursor: string | null;
  limit: number;
  hasMore: boolean;
}

export type PaginationInfo = PagePagination | CursorPagination;

// ── Response envelope ────────────────────────────────────────────────────────

export interface ResponseMetadata {
  requestId: string;
  latencyMs: number;
  cached: boolean;
  dataSourceCount: number;
}

export interface ApiEnvelope<T, P extends PaginationInfo | undefined = undefined> {
  data: T;
  metadata: ResponseMetadata;
  provenance: string[];
  timestamp: string;
  version: string;
  pagination: P;
}

export type SingleEnvelope<T> = ApiEnvelope<T, undefined>;
export type PagedEnvelope<T> = ApiEnvelope<T[], PagePagination>;
export type CursorEnvelope<T> = ApiEnvelope<T[], CursorPagination>;

// ── Company summary (used in search results) ─────────────────────────────────

export interface CompanySummary {
  id: string;
  name: string;
  normalizedName: string;
  domain: string | null;
  countryCode: string | null;
  jurisdictionCode: string | null;
  status: string;
  updatedAt: string;
}

// ── Company detail (used in lookup) ──────────────────────────────────────────

export interface CompanyIdentifierView {
  type: string;
  value: string;
  jurisdiction: string | null;
  registrar: string | null;
  issuedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface CompanyAddressView {
  type: string | null;
  addressLines: string[];
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface CompanyClassificationView {
  system: string;
  code: string;
  label: string | null;
  isPrimary: boolean;
  validFrom: string | null;
  validTo: string | null;
}

export interface CompanyExchangeListingView {
  exchange: string;
  ticker: string;
  currency: string | null;
  isPrimary: boolean;
  listingStatus: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface CompanyDetail extends CompanySummary {
  legalName: string | null;
  aliases: string[];
  description: string | null;
  foundedDate: string | null;
  incorporatedDate: string | null;
  website: string | null;
  identifiers: CompanyIdentifierView[];
  addresses: CompanyAddressView[];
  classifications: CompanyClassificationView[];
  exchangeListings: CompanyExchangeListingView[];
  createdAt: string;
}

// ── Relationship view ─────────────────────────────────────────────────────────

export interface CompanyRelationshipView {
  id: string;
  relatedCompanyId: string;
  relatedCompanyName: string;
  relationshipType: string;
  direction: 'inbound' | 'outbound';
  confidence: number;
  validFrom: string | null;
  validTo: string | null;
  source: string;
}

// ── Timeline event ────────────────────────────────────────────────────────────

export interface CompanyTimelineEvent {
  id: string;
  eventType: string;
  eventDate: string;
  description: string | null;
  source: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

// ── Company health ────────────────────────────────────────────────────────────

export interface CompanyHealthView {
  companyId: string;
  overallScore: number;          // 0–100
  dataCompletenessScore: number;
  dataFreshnessScore: number;
  dataConsistencyScore: number;
  confidenceScore: number;
  lastCalculatedAt: string;
  signals: CompanyHealthSignal[];
}

export interface CompanyHealthSignal {
  category: string;
  label: string;
  value: number;
  weight: number;
  source: string;
}

// ── Opportunity intelligence ──────────────────────────────────────────────────

export interface OpportunitySignal {
  companyId: string;
  signalType: string;
  label: string;
  strength: number;              // 0–1
  detectedAt: string;
  validUntil: string | null;
  evidence: string[];
  source: string;
}

export interface OpportunityAuthenticityView {
  companyId: string;
  trustScore: number;            // 0–100
  verifiedIdentifiers: string[];
  redFlags: string[];
  lastCheckedAt: string;
  assessmentSummary: string;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export interface ProviderMetadataView {
  key: string;
  name: string;
  version: string;
  jurisdiction: string | null;
  enabled: boolean;
  capabilities: string[];
  status: string;
  lastHealthCheckAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

export interface SystemMetadataView {
  apiVersion: string;
  buildDate: string;
  registeredProviders: ProviderMetadataView[];
  registeredJobTypes: string[];
  featureFlags: Record<string, boolean>;
}

// ── Bulk lookup ───────────────────────────────────────────────────────────────

export interface BulkLookupItem {
  requestedId: string;
  found: boolean;
  company: CompanyDetail | null;
  error: string | null;
}

// ── Helper to build the envelope ─────────────────────────────────────────────

export function buildEnvelope<T>(
  data: T,
  provenance: string[],
  requestId: string,
  startMs: number,
): SingleEnvelope<T> {
  return {
    data,
    metadata: {
      requestId,
      latencyMs: Date.now() - startMs,
      cached: false,
      dataSourceCount: provenance.length,
    },
    provenance,
    timestamp: new Date().toISOString(),
    version: 'v1',
    pagination: undefined,
  };
}

export function buildPagedEnvelope<T>(
  data: T[],
  pagination: PagePagination,
  provenance: string[],
  requestId: string,
  startMs: number,
): PagedEnvelope<T> {
  return {
    data,
    metadata: {
      requestId,
      latencyMs: Date.now() - startMs,
      cached: false,
      dataSourceCount: provenance.length,
    },
    provenance,
    timestamp: new Date().toISOString(),
    version: 'v1',
    pagination,
  };
}

export function buildCursorEnvelope<T>(
  data: T[],
  pagination: CursorPagination,
  provenance: string[],
  requestId: string,
  startMs: number,
): CursorEnvelope<T> {
  return {
    data,
    metadata: {
      requestId,
      latencyMs: Date.now() - startMs,
      cached: false,
      dataSourceCount: provenance.length,
    },
    provenance,
    timestamp: new Date().toISOString(),
    version: 'v1',
    pagination,
  };
}
