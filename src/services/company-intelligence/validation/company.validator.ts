/**
 * Company data validator.
 *
 * Validates normalized company records before they are persisted. Validation
 * failures are reported as issues (errors block the record, warnings do not)
 * and are logged by the importer without stopping unrelated imports.
 */

import type { NormalizedCompanyData } from '../contracts';
import {
  isKnownIdentifierType,
  isValidIdentifierValue,
  normalizeIdentifierValue,
  REQUIRED_IDENTIFIERS_BY_JURISDICTION,
  REQUIRED_IDENTIFIERS_BY_PROVIDER,
} from '../identifiers';
import {
  isValidCountryCode,
  isValidJurisdiction,
  isFutureTimestamp,
  isValidTimestamp,
  isValidTemporalRange,
  normalizeCountryCode,
  normalizeDomain,
  normalizeJurisdiction,
  normalizeTicker,
} from '../normalization';
import type { ValidationIssue, ValidationReport } from './validation.types';

export interface ValidationContext {
  /** Acceptable clock skew when flagging future timestamps (ms). */
  futureToleranceMs?: number;
}

/** Default tolerance: allow up to 30 days in the future (registrar backdating). */
const DEFAULT_FUTURE_TOLERANCE_MS = 30 * 24 * 60 * 60 * 1000;

export class CompanyValidator {
  validate(data: NormalizedCompanyData, context: ValidationContext = {}): ValidationReport {
    const issues: ValidationIssue[] = [];
    const toleranceMs = context.futureToleranceMs ?? DEFAULT_FUTURE_TOLERANCE_MS;

    this.validateIdentity(data, issues);
    this.validateIdentifiers(data, issues);
    this.validateDomainsAndWebsites(data, issues);
    this.validateJurisdictionAndCountry(data, issues);
    this.validateTimestamps(data, issues, toleranceMs);
    this.validateDerivedFields(data, issues);

    const hasErrors = issues.some((issue) => issue.severity === 'error');
    return {
      valid: !hasErrors,
      hasErrors,
      hasWarnings: issues.some((issue) => issue.severity === 'warning'),
      issues,
    };
  }

  // ── Rule groups ─────────────────────────────────────────────────────────

  private validateIdentity(data: NormalizedCompanyData, issues: ValidationIssue[]): void {
    if (!data.name || data.name.trim().length === 0) {
      issues.push(this.issue('error', 'name', 'MISSING_NAME', 'Company name is required'));
    }
    if (!data.normalizedName || data.normalizedName.trim().length === 0) {
      issues.push(
        this.issue('error', 'normalizedName', 'MISSING_NORMALIZED_NAME', 'Normalized name is required'),
      );
    }
    if (data.fetchedAt && !isValidTimestamp(data.fetchedAt)) {
      issues.push(
        this.issue('error', 'fetchedAt', 'INVALID_TIMESTAMP', `fetchedAt is not a valid timestamp`),
      );
    }
  }

  private validateIdentifiers(data: NormalizedCompanyData, issues: ValidationIssue[]): void {
    const seen = new Set<string>();

    data.identifiers.forEach((identifier, index) => {
      const base = `identifiers[${index}]`;
      if (!isKnownIdentifierType(identifier.type)) {
        issues.push(
          this.issue(
            'warning',
            `${base}.type`,
            'UNKNOWN_IDENTIFIER_TYPE',
            `Unknown identifier type '${identifier.type}'`,
          ),
        );
      }
      if (!identifier.value || identifier.value.trim().length === 0) {
        issues.push(
          this.issue(
            'error',
            `${base}.value`,
            'MISSING_IDENTIFIER_VALUE',
            'Identifier value is required',
          ),
        );
        return;
      }

      if (!isValidIdentifierValue(identifier.type, identifier.value)) {
        issues.push(
          this.issue(
            'warning',
            `${base}.value`,
            'INVALID_IDENTIFIER_FORMAT',
            `Identifier value '${identifier.value}' does not match the ${identifier.type} format`,
          ),
        );
      }

      const normalized = normalizeIdentifierValue(identifier.value);
      const key = `${identifier.type}:${normalized}:${identifier.jurisdiction ?? ''}`;
      if (seen.has(key)) {
        issues.push(
          this.issue(
            'error',
            `${base}.value`,
            'DUPLICATE_IDENTIFIER',
            `Duplicate identifier (${identifier.type}) within the same record`,
          ),
        );
      }
      seen.add(key);
    });

    // Missing required identifiers for the provider / jurisdiction.
    const required =
      REQUIRED_IDENTIFIERS_BY_PROVIDER[data.providerKey] ??
      (data.jurisdiction
        ? REQUIRED_IDENTIFIERS_BY_JURISDICTION[data.jurisdiction.toUpperCase()]
        : undefined);

    if (required && required.length > 0) {
      const present = new Set(data.identifiers.map((i) => i.type));
      const missing = required.filter((type) => !present.has(type));
      if (missing.length > 0) {
        issues.push(
          this.issue(
            'error',
            'identifiers',
            'MISSING_REQUIRED_IDENTIFIER',
            `Missing required identifier type(s): ${missing.join(', ')} for provider '${data.providerKey}'`,
          ),
        );
      }
    }
  }

  private validateDomainsAndWebsites(data: NormalizedCompanyData, issues: ValidationIssue[]): void {
    if (data.domain && !normalizeDomain(data.domain)) {
      issues.push(
        this.issue('error', 'domain', 'INVALID_DOMAIN', `'${data.domain}' is not a valid domain`),
      );
    }

    if (data.website) {
      try {
        const url = new URL(data.website);
        if (!/^https?:$/.test(url.protocol)) {
          throw new Error('unsupported protocol');
        }
      } catch {
        issues.push(
          this.issue('warning', 'website', 'INVALID_WEBSITE', `'${data.website}' is not a valid URL`),
        );
      }
    }

    data.websites.forEach((website, index) => {
      if (!website.url) {
        issues.push(
          this.issue(
            'warning',
            `websites[${index}].url`,
            'INVALID_WEBSITE',
            'Website URL is required',
          ),
        );
        return;
      }
      try {
        const url = new URL(website.url);
        if (!/^https?:$/.test(url.protocol)) {
          throw new Error('unsupported protocol');
        }
      } catch {
        issues.push(
          this.issue(
            'warning',
            `websites[${index}].url`,
            'INVALID_WEBSITE',
            `'${website.url}' is not a valid URL`,
          ),
        );
      }
    });
  }

  private validateJurisdictionAndCountry(
    data: NormalizedCompanyData,
    issues: ValidationIssue[],
  ): void {
    if (data.countryCode && !isValidCountryCode(data.countryCode)) {
      issues.push(
        this.issue(
          'error',
          'countryCode',
          'INVALID_COUNTRY_CODE',
          `'${data.countryCode}' is not a valid ISO 3166-1 country code`,
        ),
      );
    }

    if (data.jurisdiction && !isValidJurisdiction(data.jurisdiction)) {
      issues.push(
        this.issue(
          'warning',
          'jurisdiction',
          'INVALID_JURISDICTION',
          `'${data.jurisdiction}' is not a valid jurisdiction code`,
        ),
      );
    } else if (data.jurisdiction) {
      const parsed = normalizeJurisdiction(data.jurisdiction);
      if (parsed) {
        // A jurisdiction implies a country code when one is missing.
        if (!data.countryCode) {
          issues.push(
            this.issue(
              'warning',
              'countryCode',
              'MISSING_COUNTRY_CODE',
              'countryCode should be derived from the jurisdiction',
            ),
          );
        }
      }
    }
  }

  private validateTimestamps(
    data: NormalizedCompanyData,
    issues: ValidationIssue[],
    toleranceMs: number,
  ): void {
    const temporalFields: Array<[string, string | null | undefined]> = [
      ['foundedDate', data.foundedDate],
      ['incorporatedDate', data.incorporatedDate],
      ['validFrom', data.validFrom],
      ['validTo', data.validTo],
    ];

    for (const [field, value] of temporalFields) {
      if (value && !isValidTimestamp(value)) {
        issues.push(
          this.issue(
            'error',
            field,
            'INVALID_TIMESTAMP',
            `'${value}' is not a valid timestamp`,
          ),
        );
      } else if (value && isFutureTimestamp(value, new Date(), toleranceMs)) {
        issues.push(
          this.issue(
            'warning',
            field,
            'FUTURE_TIMESTAMP',
            `'${value}' is in the future`,
          ),
        );
      }
    }

    if (!isValidTemporalRange(data.validFrom, data.validTo)) {
      issues.push(
        this.issue(
          'error',
          'validFrom/validTo',
          'INVALID_TEMPORAL_RANGE',
          'validTo must not precede validFrom',
        ),
      );
    }
  }

  private validateDerivedFields(data: NormalizedCompanyData, issues: ValidationIssue[]): void {
    data.aliases.forEach((alias, index) => {
      if (!alias || alias.trim().length === 0) {
        issues.push(
          this.issue('warning', `aliases[${index}]`, 'EMPTY_ALIAS', 'Alias must not be empty'),
        );
      }
    });

    data.exchangeListings.forEach((listing, index) => {
      const ticker = normalizeTicker(listing.ticker);
      if (!ticker || ticker.length > 10) {
        issues.push(
          this.issue(
            'warning',
            `exchangeListings[${index}].ticker`,
            'INVALID_TICKER',
            `'${listing.ticker}' is not a valid ticker symbol`,
          ),
        );
      }
    });

    data.addresses.forEach((address, index) => {
      if (address.countryCode && !isValidCountryCode(address.countryCode)) {
        issues.push(
          this.issue(
            'warning',
            `addresses[${index}].countryCode`,
            'INVALID_COUNTRY_CODE',
            `'${address.countryCode}' is not a valid ISO 3166-1 country code`,
          ),
        );
      }
      if (address.countryCode) {
        const normalized = normalizeCountryCode(address.countryCode);
        if (normalized && normalized !== address.countryCode.toUpperCase()) {
          // address country code is an alpha-3 or alias — acceptable but flagged.
        }
      }
    });
  }

  private issue(
    severity: 'error' | 'warning',
    field: string,
    code: string,
    message: string,
  ): ValidationIssue {
    return { severity, field, code, message };
  }
}

export const companyValidator = new CompanyValidator();
