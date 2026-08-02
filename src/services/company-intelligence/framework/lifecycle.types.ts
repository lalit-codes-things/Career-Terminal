/**
 * Provider lifecycle — types.
 *
 * The lifecycle state machine describes the runtime state of a registered
 * provider:
 *
 *   registered → initializing → ready ⇄ running
 *                  │               │
 *                  ↓               ↓
 *                failed          stopped
 *
 * The registry owns the runtime-state store; the lifecycle manager mutates it.
 */

import type { ProviderHealthStatus } from '../providers/company-provider.types';

export type ProviderLifecycleState =
  | 'registered'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopped'
  | 'failed';

export interface ProviderRuntimeState {
  providerKey: string;
  state: ProviderLifecycleState;
  /** Whether initialize() completed successfully at least once. */
  initialized: boolean;
  initializedAt?: string;
  lastError?: string;
  errorCount: number;
  updatedAt: string;
}

export interface ProviderInitializeOptions {
  /** Skip the availability/health probe after initialization. Default false. */
  skipHealthCheck?: boolean;
}

/** A dependency on another registered provider. */
export interface ProviderDependency {
  providerKey: string;
  /** Hard dependencies gate discovery; soft dependencies only inform. Default true. */
  required?: boolean;
}

export type ProviderSyncMode = 'full' | 'incremental';

export interface ProviderSyncOptions {
  since?: string;
  limit?: number;
  dryRun?: boolean;
  maxRecords?: number;
  correlationId?: string;
}

export const LIFECYCLE_STATES: readonly ProviderLifecycleState[] = [
  'registered',
  'initializing',
  'ready',
  'running',
  'stopped',
  'failed',
];

export type { ProviderHealthStatus };
