/**
 * Provider lifecycle manager.
 *
 * Orchestrates the runtime lifecycle of registered providers on top of the
 * registry and the import pipeline:
 *
 *   initialize → validate config → probe availability → state 'ready'
 *   runImport  → state 'running' → delegate to CompanyImporter → state 'ready'
 *   shutdown   → state 'stopped'
 *
 * The manager never contains provider-specific logic. It is the single place
 * that transitions provider runtime state, records health observations and
 * emits observability events — so a provider that fails never crashes the
 * rest of the system.
 */

import type { Logger } from '../../../lib/logger';
import { logger as appLogger } from '../../../lib/logger';
import type { CompanyImporter } from '../importers/company-importer';
import type { ImportRunOptions, ImportRunResult } from '../importers/importer.types';
import type { CompanyProvider, ProviderHealth } from '../providers/company-provider.types';
import type { CompanyProviderRegistry } from '../providers/registry';
import { ProviderConfigurationError, providerErrorMessage } from './errors';
import { ProviderHealthTracker } from './health-tracker';
import type {
  ProviderInitializeOptions,
  ProviderRuntimeState,
  ProviderSyncMode,
  ProviderSyncOptions,
} from './lifecycle.types';
import { emitProviderEvent } from './otel';

export interface LifecycleManagerDeps {
  registry: CompanyProviderRegistry;
  importer: CompanyImporter;
  health?: ProviderHealthTracker;
  logger?: Logger;
}

export class ProviderLifecycleManager {
  private readonly registry: CompanyProviderRegistry;
  private readonly importer: CompanyImporter;
  private readonly health: ProviderHealthTracker;
  private readonly logger: Logger;

  constructor(deps: LifecycleManagerDeps) {
    this.registry = deps.registry;
    this.importer = deps.importer;
    this.health = deps.health ?? new ProviderHealthTracker();
    this.logger = deps.logger ?? appLogger;
  }

  get healthTracker(): ProviderHealthTracker {
    return this.health;
  }

  /**
   * Initialize a provider: validate its configuration, run its initialize()
   * hook and probe availability. Safe to call repeatedly; idempotent once
   * the provider is already 'ready' or 'running'.
   */
  async initialize(providerKey: string, options: ProviderInitializeOptions = {}): Promise<ProviderRuntimeState> {
    const provider = this.requireProvider(providerKey);
    const current = this.registry.getRuntimeState(providerKey);
    if (current.initialized && current.state !== 'failed') {
      return current;
    }

    this.transition(providerKey, 'initializing');
    this.logger.info('[CompanyIntel] provider initializing', { providerKey });

    try {
      if (typeof provider.validateConfiguration === 'function') {
        const report = await provider.validateConfiguration();
        if (!report.valid) {
          const issue = report.issues.find((item) => item.severity === 'error');
          throw new ProviderConfigurationError(
            issue ? `${providerKey}: ${issue.message}` : `${providerKey}: configuration invalid`,
            { providerKey, context: { issues: report.issues } },
          );
        }
      }

      if (typeof provider.initialize === 'function') {
        await provider.initialize();
      }

      let state: ProviderRuntimeState;
      if (!options.skipHealthCheck && !(await provider.isAvailable())) {
        state = this.transition(providerKey, 'ready', {
          initialized: true,
          lastError: 'Provider is configured but currently unavailable',
        });
        this.health.recordCheck(providerKey, 'degraded', {
          message: 'Provider is configured but currently unavailable',
        });
        this.logger.warn('[CompanyIntel] provider initialized but unavailable', { providerKey });
      } else {
        state = this.transition(providerKey, 'ready', { initialized: true });
        this.health.recordSuccess(providerKey);
      }

      emitProviderEvent({ type: 'initialized', providerKey, timestamp: new Date().toISOString() });
      this.logger.info('[CompanyIntel] provider ready', { providerKey });
      return state;
    } catch (err) {
      const message = providerErrorMessage(err);
      const state = this.transition(providerKey, 'failed', { lastError: message });
      this.health.recordFailure(providerKey, err);
      emitProviderEvent({ type: 'initialize_failed', providerKey, timestamp: new Date().toISOString(), attributes: { error: message } });
      this.logger.error('[CompanyIntel] provider initialization failed', { providerKey, error: message });
      return state;
    }
  }

  /** Shut a provider down (state → 'stopped'). Idempotent. */
  async shutdown(providerKey: string): Promise<ProviderRuntimeState> {
    const provider = this.requireProvider(providerKey);
    if (typeof provider.shutdown === 'function') {
      try {
        await provider.shutdown();
      } catch (err) {
        this.logger.warn('[CompanyIntel] provider shutdown hook failed', {
          providerKey,
          error: providerErrorMessage(err),
        });
      }
    }
    const state = this.transition(providerKey, 'stopped', { initialized: false });
    emitProviderEvent({ type: 'shutdown', providerKey, timestamp: new Date().toISOString() });
    this.logger.info('[CompanyIntel] provider shut down', { providerKey });
    return state;
  }

  /** Shut down all registered providers. Never throws; failures are logged. */
  async shutdownAll(): Promise<void> {
    for (const provider of this.registry.all()) {
      await this.shutdown(provider.key);
    }
  }

  /** Run a full or incremental import through the lifecycle state machine. */
  async runSync(providerKey: string, mode: ProviderSyncMode, options: ProviderSyncOptions = {}): Promise<ImportRunResult> {
    return this.runImport(providerKey, {
      importType: mode === 'incremental' ? 'INCREMENTAL' : 'FULL',
      since: options.since,
      limit: options.limit,
      dryRun: options.dryRun,
      maxRecords: options.maxRecords,
      correlationId: options.correlationId,
    });
  }

  /** Convenience wrapper: full sync. */
  runFullSync(providerKey: string, options: ProviderSyncOptions = {}): Promise<ImportRunResult> {
    return this.runSync(providerKey, 'full', options);
  }

  /** Convenience wrapper: incremental sync. */
  runIncrementalSync(providerKey: string, options: ProviderSyncOptions = {}): Promise<ImportRunResult> {
    return this.runSync(providerKey, 'incremental', options);
  }

  /**
   * Run an import under lifecycle control: ensure the provider is initialized,
   * transition to 'running', delegate to the importer, record health and emit
   * observability events. Disabled providers are delegated to the importer,
   * which returns a 'skipped' run instead of throwing.
   */
  async runImport(providerKey: string, options: ImportRunOptions): Promise<ImportRunResult> {
    const provider = this.requireProvider(providerKey);

    if (provider.enabled && this.registry.isEnabled(providerKey)) {
      await this.initialize(providerKey);
    }

    this.transition(providerKey, 'running');
    const startedAt = Date.now();
    emitProviderEvent({ type: 'import_started', providerKey, timestamp: new Date().toISOString(), attributes: { importType: options.importType ?? 'FULL' } });

    let result: ImportRunResult;
    try {
      result = await this.importer.runImport({ ...options, providerKey });
    } catch (err) {
      const message = providerErrorMessage(err);
      this.health.recordFailure(providerKey, err, { latencyMs: Date.now() - startedAt });
      emitProviderEvent({ type: 'import_failed', providerKey, timestamp: new Date().toISOString(), attributes: { error: message } });
      this.transition(providerKey, 'failed', { lastError: message });
      throw err;
    }

    if (result.status === 'success') {
      this.health.recordSuccess(providerKey, { latencyMs: result.durationMs });
      emitProviderEvent({ type: 'import_completed', providerKey, timestamp: new Date().toISOString(), attributes: { status: result.status } });
    } else {
      this.health.recordFailure(providerKey, new Error(result.error ?? `import ${result.status}`), {
        latencyMs: result.durationMs,
      });
      emitProviderEvent({ type: 'import_completed', providerKey, timestamp: new Date().toISOString(), attributes: { status: result.status } });
    }

    this.transition(providerKey, 'ready', { initialized: true });
    return result;
  }

  /** Run a live health check against a provider and record the observation. */
  async checkHealth(providerKey: string): Promise<ProviderHealth> {
    const provider = this.requireProvider(providerKey);
    const startedAt = Date.now();
    let health: ProviderHealth;
    try {
      health = await provider.health();
    } catch (err) {
      const message = providerErrorMessage(err);
      this.health.recordFailure(providerKey, err, { latencyMs: Date.now() - startedAt });
      emitProviderEvent({ type: 'health_checked', providerKey, timestamp: new Date().toISOString(), attributes: { status: 'unhealthy', error: message } });
      throw err;
    }
    this.health.recordCheck(providerKey, health.status, {
      latencyMs: Date.now() - startedAt,
      message: health.message,
    });
    emitProviderEvent({ type: 'health_checked', providerKey, timestamp: new Date().toISOString(), attributes: { status: health.status } });
    return health;
  }

  /** Run health checks for all providers; a single failing provider never aborts the rest. */
  async checkAllHealth(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const provider of this.registry.all()) {
      try {
        results.push(await this.checkHealth(provider.key));
      } catch (err) {
        this.logger.error('[CompanyIntel] health check failed', {
          providerKey: provider.key,
          error: providerErrorMessage(err),
        });
      }
    }
    return results;
  }

  getState(providerKey: string): ProviderRuntimeState | undefined {
    return this.registry.getRuntimeState(providerKey);
  }

  states(): ProviderRuntimeState[] {
    return this.registry.runtimeStates();
  }

  private requireProvider(providerKey: string): CompanyProvider {
    const provider = this.registry.get(providerKey);
    if (!provider) {
      throw new ProviderConfigurationError(
        `ProviderLifecycleManager: no provider registered with key '${providerKey}'`,
        { providerKey },
      );
    }
    return provider;
  }

  private transition(
    providerKey: string,
    state: ProviderRuntimeState['state'],
    patch: Partial<Omit<ProviderRuntimeState, 'providerKey' | 'state' | 'updatedAt'>> = {},
  ): ProviderRuntimeState {
    return this.registry.setRuntimeState(providerKey, { state, ...patch });
  }
}
