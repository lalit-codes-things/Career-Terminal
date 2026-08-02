/**
 * Company provider registry.
 *
 * Central catalog of `CompanyProvider` implementations, keyed by provider key.
 * The registry is intentionally provider-agnostic: it stores providers, answers
 * queries, tracks runtime state and registration metadata (priority,
 * dependencies, version), and supports enable/disable overrides and discovery.
 * The lifecycle manager and import pipeline decide *whether* a provider runs —
 * the registry never does.
 *
 * A provider that fails is never fatal to the registry: health/lifecycle
 * concerns are delegated to the framework, and every query degrades gracefully.
 */

import {
  companyIntelConfig,
  companiesHouseProviderConfig,
  indiaMcaProviderConfig,
  secProviderConfig,
} from '../config';
import type { ProviderRuntimeState } from '../framework/lifecycle.types';
import { ProviderConfigurationError } from '../framework/errors';
import { emitProviderEvent } from '../framework/otel';
import { createCompanyDataStorage, type CompanyDataStorage } from '../storage';
import { CompaniesHouseProvider } from './companies-house.provider';
import type { CompanyProvider, ProviderCapabilities } from './company-provider.types';
import { IndiaMcaProvider } from './india-mca.provider';
import { SecProvider } from './sec.provider';

/** A dependency on another registered provider. */
export interface ProviderDependency {
  providerKey: string;
  /** Hard dependencies gate discovery; soft dependencies only inform. Default true. */
  required?: boolean;
}

export interface ProviderRegistrationOptions {
  /** Discovery sort order — lower runs first. Default 1000. */
  priority?: number;
  /** Provider dependencies (must be registered first for hard deps). */
  dependencies?: ProviderDependency[];
  /** Arbitrary registration metadata surfaced via discovery. */
  metadata?: Record<string, unknown>;
}

export interface ProviderRegistration {
  provider: CompanyProvider;
  options: {
    priority: number;
    dependencies: ProviderDependency[];
    metadata: Record<string, unknown>;
  };
  registeredAt: string;
}

export interface ProviderDiscoveryEntry {
  key: string;
  name: string;
  version: string;
  jurisdiction: string | null;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  priority: number;
  dependencies: ProviderDependency[];
  registeredAt: string;
  metadata: Record<string, unknown>;
  state: ProviderRuntimeState;
}

const DEFAULT_PRIORITY = 1000;

export class CompanyProviderRegistry {
  private readonly providers = new Map<string, CompanyProvider>();
  private readonly registrations = new Map<string, ProviderRegistration>();
  private readonly runtimeStates = new Map<string, ProviderRuntimeState>();
  private readonly enabledOverrides = new Map<string, boolean>();

  register(provider: CompanyProvider, options: ProviderRegistrationOptions = {}): void {
    if (this.providers.has(provider.key)) {
      throw new ProviderConfigurationError(
        `CompanyProviderRegistry: provider '${provider.key}' is already registered`,
        { providerKey: provider.key },
      );
    }

    const dependencies = options.dependencies ?? [];
    const missing = dependencies
      .filter((dep) => dep.required !== false && !this.providers.has(dep.providerKey))
      .map((dep) => dep.providerKey);
    if (missing.length > 0) {
      throw new ProviderConfigurationError(
        `CompanyProviderRegistry: provider '${provider.key}' declares missing required dependencies: ${missing.join(', ')}`,
        { providerKey: provider.key, context: { missing } },
      );
    }

    const now = new Date().toISOString();
    this.providers.set(provider.key, provider);
    this.registrations.set(provider.key, {
      provider,
      options: {
        priority: options.priority ?? DEFAULT_PRIORITY,
        dependencies,
        metadata: options.metadata ?? {},
      },
      registeredAt: now,
    });
    this.runtimeStates.set(provider.key, {
      providerKey: provider.key,
      state: 'registered',
      initialized: false,
      errorCount: 0,
      updatedAt: now,
    });

    emitProviderEvent({ type: 'registered', providerKey: provider.key, timestamp: now });
  }

  /** Remove a provider. Returns true when a provider was removed. */
  unregister(key: string): boolean {
    const removed =
      this.providers.delete(key) ||
      this.registrations.delete(key) ||
      this.runtimeStates.delete(key) ||
      this.enabledOverrides.delete(key);
    emitProviderEvent({ type: 'unregistered', providerKey: key, timestamp: new Date().toISOString() });
    return removed;
  }

  get(key: string): CompanyProvider | undefined {
    return this.providers.get(key);
  }

  all(): CompanyProvider[] {
    return [...this.providers.values()];
  }

  keys(): string[] {
    return [...this.providers.keys()];
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  // ── Enable / disable overrides ─────────────────────────────────────────

  /** Runtime override — forces a provider enabled regardless of config. */
  enable(key: string): void {
    this.enabledOverrides.set(key, true);
    emitProviderEvent({ type: 'enabled', providerKey: key, timestamp: new Date().toISOString() });
  }

  /** Runtime override — forces a provider disabled regardless of config. */
  disable(key: string): void {
    this.enabledOverrides.set(key, false);
    emitProviderEvent({ type: 'disabled', providerKey: key, timestamp: new Date().toISOString() });
  }

  /** Clear any runtime override, falling back to the provider's config. */
  clearEnableOverride(key: string): void {
    this.enabledOverrides.delete(key);
  }

  isEnabled(key: string): boolean {
    const override = this.enabledOverrides.get(key);
    if (override !== undefined) {
      return override;
    }
    return this.providers.get(key)?.enabled ?? false;
  }

  enabled(): CompanyProvider[] {
    return this.all().filter((provider) => this.isEnabled(provider.key));
  }

  // ── Dependencies ────────────────────────────────────────────────────────

  dependenciesOf(key: string): ProviderDependency[] {
    return this.registrations.get(key)?.options.dependencies ?? [];
  }

  /** Unmet required dependencies for a provider (empty when all satisfied). */
  unmetDependencies(key: string): ProviderDependency[] {
    return this.dependenciesOf(key).filter(
      (dep) => dep.required !== false && !this.providers.has(dep.providerKey),
    );
  }

  /** True when all required dependencies are registered. */
  hasSatisfiedDependencies(key: string): boolean {
    return this.unmetDependencies(key).length === 0;
  }

  // ── Versioning ──────────────────────────────────────────────────────────

  getVersion(key: string): string | undefined {
    return this.providers.get(key)?.version;
  }

  // ── Runtime state ───────────────────────────────────────────────────────

  getRuntimeState(key: string): ProviderRuntimeState {
    const existing = this.runtimeStates.get(key);
    if (existing) {
      return existing;
    }
    return {
      providerKey: key,
      state: 'registered',
      initialized: false,
      errorCount: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  setRuntimeState(
    key: string,
    patch: Partial<Omit<ProviderRuntimeState, 'providerKey' | 'updatedAt'>>,
  ): ProviderRuntimeState {
    const current = this.getRuntimeState(key);
    const next: ProviderRuntimeState = {
      ...current,
      ...patch,
      providerKey: key,
      updatedAt: new Date().toISOString(),
      errorCount: patch.errorCount ?? current.errorCount,
    };
    this.runtimeStates.set(key, next);
    return next;
  }

  runtimeStates(): ProviderRuntimeState[] {
    return [...this.runtimeStates.values()].map((state) => ({ ...state }));
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  /**
   * Discovery snapshot of all registered providers, sorted by priority
   * (ascending). Sync — availability/health are not probed here.
   */
  discover(): ProviderDiscoveryEntry[] {
    return [...this.registrations.values()]
      .map(({ provider, options, registeredAt }) => ({
        key: provider.key,
        name: provider.name,
        version: provider.version,
        jurisdiction: provider.jurisdiction,
        enabled: this.isEnabled(provider.key),
        capabilities: provider.capabilities,
        priority: options.priority,
        dependencies: options.dependencies,
        registeredAt,
        metadata: options.metadata,
        state: this.getRuntimeState(provider.key),
      }))
      .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  }
}

/**
 * Build the standard registry: SEC, Companies House and India MCA, each wired
 * to the configured storage backend and environment-only credentials.
 */
export function createDefaultRegistry(storage?: CompanyDataStorage): CompanyProviderRegistry {
  const registry = new CompanyProviderRegistry();

  registry.register(
    new SecProvider(
      secProviderConfig,
      storage ??
        createCompanyDataStorage({
          backend: companyIntelConfig.storageBackend,
          localRootDir: companyIntelConfig.localDataDir,
          s3Bucket: companyIntelConfig.s3Bucket,
          s3Prefix: companyIntelConfig.s3Prefix,
          s3Endpoint: companyIntelConfig.s3Endpoint,
        }),
    ),
  );
  registry.register(new CompaniesHouseProvider(companiesHouseProviderConfig));
  registry.register(new IndiaMcaProvider(indiaMcaProviderConfig));

  return registry;
}
