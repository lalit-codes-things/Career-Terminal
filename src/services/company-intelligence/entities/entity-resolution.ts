/**
 * Company entity resolution.
 *
 * Decides whether an incoming normalized company record refers to an already
 * known canonical company. Resolution is deterministic and prioritised:
 *
 *   1. Strong identifiers (registration numbers, LEI, CIK…) — highest priority.
 *   2. Normalized apex domain.
 *   3. Normalized website URL.
 *   4. Exact normalized name + jurisdiction (weakest, scoped by jurisdiction).
 *
 * When a strong match (identifier or domain) is found, weaker signals are not
 * evaluated, which keeps the pipeline cheap and avoids cross-source conflicts.
 * If multiple strong signals disagree, an `EntityResolutionConflictError` is
 * raised so the caller can log and skip the record.
 */

import { randomUUID } from 'node:crypto';
import type { NormalizedCompanyData } from '../contracts';
import {
  normalizeDomain,
  normalizeJurisdiction,
  normalizeIdentifierValue,
} from '../normalization';
import type {
  CompanyIntelRepository,
  ResolutionResult,
} from '../repository/company-intel.repository';

export interface EntityResolutionConfig {
  matchOnIdentifiers?: boolean;
  matchOnDomain?: boolean;
  matchOnWebsite?: boolean;
  matchOnNameAndJurisdiction?: boolean;
  /** Identifier types whose value alone identifies an entity globally. */
  globallyUniqueIdentifierTypes?: Set<string>;
}

export const DEFAULT_ENTITY_RESOLUTION_CONFIG: Required<EntityResolutionConfig> = {
  matchOnIdentifiers: true,
  matchOnDomain: true,
  matchOnWebsite: true,
  matchOnNameAndJurisdiction: true,
  globallyUniqueIdentifierTypes: new Set(['lei', 'cik']),
};

/** Raised when resolution signals point at different canonical companies. */
export class EntityResolutionConflictError extends Error {
  constructor(
    public readonly companyId: string,
    readonly reasons: string[],
  ) {
    super(
      `Entity resolution conflict: signals ${reasons.join(', ')} refer to different companies`,
    );
    this.name = 'EntityResolutionConflictError';
  }
}

interface CandidateMatch {
  companyId: string;
  reason: string;
}

type ResolverRepository = Pick<
  CompanyIntelRepository,
  | 'findCompanyByIdentifier'
  | 'findCompanyByDomain'
  | 'findCompanyByNameAndJurisdiction'
  | 'findCompanyByWebsite'
>;

export class CompanyEntityResolver {
  constructor(
    private readonly repo: ResolverRepository,
    private readonly config: EntityResolutionConfig = DEFAULT_ENTITY_RESOLUTION_CONFIG,
  ) {}

  async resolve(data: NormalizedCompanyData): Promise<ResolutionResult> {
    const cfg = { ...DEFAULT_ENTITY_RESOLUTION_CONFIG, ...this.config };

    const strongMatches: CandidateMatch[] = [];

    if (cfg.matchOnIdentifiers) {
      strongMatches.push(...(await this.matchByIdentifiers(data)));
    }

    if (strongMatches.length === 0) {
      if (cfg.matchOnDomain) {
        strongMatches.push(...(await this.matchByDomain(data)));
      }
      if (strongMatches.length === 0 && cfg.matchOnWebsite) {
        strongMatches.push(...(await this.matchByWebsite(data)));
      }
      if (strongMatches.length === 0 && cfg.matchOnNameAndJurisdiction) {
        strongMatches.push(...(await this.matchByNameAndJurisdiction(data)));
      }
    }

    if (strongMatches.length === 0) {
      return {
        canonicalCompanyId: randomUUID(),
        created: true,
        updated: false,
        matched: false,
        matchedBy: [],
      };
    }

    const distinct = new Map<string, CandidateMatch>();
    for (const match of strongMatches) {
      const existing = distinct.get(match.companyId);
      if (existing && !existing.reason.includes(match.reason)) {
        existing.reason = `${existing.reason};${match.reason}`;
      } else if (!existing) {
        distinct.set(match.companyId, match);
      }
    }

    if (distinct.size > 1) {
      const ids = [...distinct.values()];
      throw new EntityResolutionConflictError(ids[0]!.companyId, ids.map((m) => m.reason));
    }

    const winner = distinct.values().next().value as CandidateMatch;
    return {
      canonicalCompanyId: winner.companyId,
      created: false,
      updated: true,
      matched: true,
      matchedBy: winner.reason.split(';'),
    };
  }

  // ── Lookup phases ───────────────────────────────────────────────────────

  private async matchByIdentifiers(
    data: NormalizedCompanyData,
  ): Promise<CandidateMatch[]> {
    const matches: CandidateMatch[] = [];
    for (const identifier of data.identifiers) {
      const type = identifier.type;
      const value = normalizeIdentifierValue(identifier.value);
      if (!value) {
        continue;
      }
      const global = this.config.globallyUniqueIdentifierTypes?.has(type);
      const company = await this.repo.findCompanyByIdentifier(
        type,
        value,
        global ? null : (identifier.jurisdiction ?? data.jurisdiction ?? null),
      );
      if (company) {
        matches.push({ companyId: company.id, reason: `identifier:${type}` });
      }
    }
    return matches;
  }

  private async matchByDomain(data: NormalizedCompanyData): Promise<CandidateMatch[]> {
    if (!data.domain) {
      return [];
    }
    const normalized = normalizeDomain(data.domain);
    if (!normalized) {
      return [];
    }
    const company = await this.repo.findCompanyByDomain(normalized);
    return company ? [{ companyId: company.id, reason: 'domain' }] : [];
  }

  private async matchByWebsite(data: NormalizedCompanyData): Promise<CandidateMatch[]> {
    if (!data.website) {
      return [];
    }
    const normalized = this.normalizeWebsiteUrl(data.website);
    if (!normalized) {
      return [];
    }
    const company = await this.repo.findCompanyByWebsite(normalized);
    return company ? [{ companyId: company.id, reason: 'website' }] : [];
  }

  private async matchByNameAndJurisdiction(
    data: NormalizedCompanyData,
  ): Promise<CandidateMatch[]> {
    if (!data.jurisdiction || !data.normalizedName) {
      return [];
    }
    const jurisdiction = normalizeJurisdiction(data.jurisdiction);
    if (!jurisdiction) {
      return [];
    }
    const company = await this.repo.findCompanyByNameAndJurisdiction(
      data.normalizedName,
      jurisdiction,
    );
    return company ? [{ companyId: company.id, reason: 'name' }] : [];
  }

  private normalizeWebsiteUrl(value: string): string | null {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) {
        return null;
      }
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      url.pathname = url.pathname.toLowerCase();
      return url.toString();
    } catch {
      return null;
    }
  }
}

export const createCompanyEntityResolver = (
  repo: ResolverRepository,
  config?: EntityResolutionConfig,
): CompanyEntityResolver => new CompanyEntityResolver(repo, config);
