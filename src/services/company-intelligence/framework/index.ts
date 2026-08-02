/**
 * Company Intelligence — provider framework.
 *
 * Runtime infrastructure for company data providers: capability model,
 * standardized errors, health tracking, lifecycle management and observability
 * hooks. The framework is provider-agnostic; it builds on the existing
 * `CompanyProvider` contract, the registry and the import pipeline.
 */

export * from './capabilities';
export * from './errors';
export * from './health-tracker';
export * from './lifecycle.types';
export * from './lifecycle-manager';
export * from './otel';
