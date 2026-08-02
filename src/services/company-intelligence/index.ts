/**
 * Company Intelligence — foundation.
 *
 * Aggregated public surface for the company data foundation: providers,
 * import pipeline, normalization, validation, entity resolution, storage and
 * repository contracts. Consumers (queue workers, admin routes, tests) import
 * from here instead of individual modules.
 *
 * This module intentionally exposes no analytics, scoring or enrichment
 * functionality.
 */

export * from './config';
export * from './contracts';
export * from './identifiers';
export * from './normalization';
export * from './validation';
export * from './entities';
export * from './storage';
export * from './providers';
export * from './repository';
export * from './importers';
