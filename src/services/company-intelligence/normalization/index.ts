/**
 * Company Intelligence — normalization utilities.
 *
 * Provider-agnostic helpers for normalizing company names, domains, countries,
 * legal suffixes, identifiers, tickers, jurisdictions and timestamps. Every
 * provider (SEC, Companies House, India MCA, future providers) routes its raw
 * data through these functions so that resolution and persistence compare
 * identical keys.
 */

export * from './company-name';
export * from './domain';
export * from './country';
export * from './legal-suffix';
export * from './identifier';
export * from './ticker';
export * from './jurisdiction';
export * from './timestamp';
export * from './record-normalizer';
