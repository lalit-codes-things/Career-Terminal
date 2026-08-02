/**
 * Provider health tracker.
 *
 * Tracks per-provider runtime health across import runs and health checks:
 * last success/failure, latency, and consecutive failures. Status is derived
 * from consecutive failures against a configurable threshold:
 *
 *   no history  → 'unknown'
 *   0 failures  → 'healthy'
 *   1..n-1      → 'degraded'
 *   >= n        → 'unhealthy'
 *
 * The tracker is a pure in-memory observer: it never calls providers, never
 * throws for unknown keys, and never blocks the import pipeline.
 */

import type { ProviderHealthStatus } from '../providers/company-provider.types';

export interface HealthTrackerOptions {
  /** Consecutive failures after which a provider is 'unhealthy'. Default 3. */
  failureThreshold?: number;
  now?: () => Date;
}

export interface ProviderHealthSnapshot {
  providerKey: string;
  status: ProviderHealthStatus;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastCheckedAt?: string;
  lastLatencyMs?: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface RecordSuccessOptions {
  latencyMs?: number;
  checkedAt?: Date;
}

export interface RecordFailureOptions {
  latencyMs?: number;
  checkedAt?: Date;
}

export class ProviderHealthTracker {
  private readonly failureThreshold: number;
  private readonly now: () => Date;
  private readonly entries = new Map<string, ProviderHealthSnapshot>();

  constructor(options: HealthTrackerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.now = options.now ?? (() => new Date());
  }

  recordSuccess(providerKey: string, options: RecordSuccessOptions = {}): ProviderHealthSnapshot {
    const snapshot = this.read(providerKey);
    snapshot.status = 'healthy';
    snapshot.consecutiveFailures = 0;
    snapshot.lastSuccessAt = (options.checkedAt ?? this.now()).toISOString();
    snapshot.lastCheckedAt = snapshot.lastSuccessAt;
    if (options.latencyMs !== undefined) {
      snapshot.lastLatencyMs = options.latencyMs;
    }
    snapshot.lastError = undefined;
    this.write(providerKey, snapshot);
    return snapshot;
  }

  recordFailure(
    providerKey: string,
    error?: unknown,
    options: RecordFailureOptions = {},
  ): ProviderHealthSnapshot {
    const snapshot = this.read(providerKey);
    snapshot.consecutiveFailures += 1;
    snapshot.status = this.statusFor(snapshot.consecutiveFailures);
    snapshot.lastFailureAt = (options.checkedAt ?? this.now()).toISOString();
    snapshot.lastCheckedAt = snapshot.lastFailureAt;
    if (options.latencyMs !== undefined) {
      snapshot.lastLatencyMs = options.latencyMs;
    }
    snapshot.lastError = error instanceof Error ? error.message : error == null ? undefined : String(error);
    this.write(providerKey, snapshot);
    return snapshot;
  }

  /** Register a health-check observation with an explicit status. */
  recordCheck(
    providerKey: string,
    status: ProviderHealthStatus,
    options: RecordFailureOptions & { message?: string } = {},
  ): ProviderHealthSnapshot {
    if (status === 'healthy') {
      return this.recordSuccess(providerKey, options);
    }
    const snapshot = this.read(providerKey);
    snapshot.status = status;
    snapshot.lastCheckedAt = (options.checkedAt ?? this.now()).toISOString();
    if (status === 'unhealthy') {
      snapshot.consecutiveFailures += 1;
    }
    if (options.message !== undefined) {
      snapshot.lastError = options.message;
    }
    this.write(providerKey, snapshot);
    return snapshot;
  }

  getSnapshot(providerKey: string): ProviderHealthSnapshot | undefined {
    return this.read(providerKey);
  }

  statusOf(providerKey: string): ProviderHealthStatus {
    return this.read(providerKey).status;
  }

  all(): ProviderHealthSnapshot[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  reset(providerKey?: string): void {
    if (providerKey === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(providerKey);
  }

  private read(providerKey: string): ProviderHealthSnapshot {
    const existing = this.entries.get(providerKey);
    if (existing) {
      return existing;
    }
    return {
      providerKey,
      status: 'unknown',
      consecutiveFailures: 0,
    };
  }

  private write(providerKey: string, snapshot: ProviderHealthSnapshot): void {
    this.entries.set(providerKey, { ...snapshot });
  }

  private statusFor(consecutiveFailures: number): ProviderHealthStatus {
    if (consecutiveFailures <= 0) {
      return 'healthy';
    }
    return consecutiveFailures >= this.failureThreshold ? 'unhealthy' : 'degraded';
  }
}
