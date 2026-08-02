/**
 * Import planner — decides whether/how an import run should execute.
 *
 * The planner is a pure function of (provider, repository availability, time);
 * it never performs I/O itself beyond provider capability checks. Skipped
 * plans carry a machine-readable reason the importer records on the run.
 */

import type { CompanyProvider, ImportType } from '../providers';
import type { ImportPlan, ImportRunOptions } from './importer.types';

export interface PlannerContext {
  provider?: CompanyProvider | null;
  available: boolean;
  now?: Date;
}

export type PlanReason = 'ok' | 'provider-not-found' | 'provider-disabled' | 'provider-unavailable' | 'mode-unsupported';

export interface BuildPlanResult extends ImportPlan {
  reason: PlanReason;
  /** Human-readable explanation for skipped plans. */
  reasonText?: string;
}

/** Default cadence between scheduled runs, per import type. */
const SCHEDULE_INTERVALS_MS: Readonly<Partial<Record<ImportType, number>>> = {
  FULL: 7 * 24 * 60 * 60 * 1000,
  INCREMENTAL: 24 * 60 * 60 * 1000,
  SCHEDULED: 24 * 60 * 60 * 1000,
  MANUAL: 24 * 60 * 60 * 1000,
};

export function buildImportPlan(
  options: ImportRunOptions,
  context: PlannerContext,
): BuildPlanResult {
  const now = context.now ?? new Date();
  const importType = options.importType ?? 'FULL';

  const base = {
    providerKey: options.providerKey,
    importType,
    since: options.since,
  };

  if (!context.provider) {
    return {
      ...base,
      reason: 'provider-not-found',
      scheduled: false,
      reasonText: `No provider registered with key '${options.providerKey}'`,
    };
  }

  if (!context.provider.enabled) {
    return {
      ...base,
      reason: 'provider-disabled',
      scheduled: false,
      reasonText: `Provider '${options.providerKey}' is disabled by configuration`,
    };
  }

  if (!context.provider.capabilities.importTypes.includes(importType)) {
    return {
      ...base,
      reason: 'mode-unsupported',
      scheduled: false,
      reasonText: `Provider '${options.providerKey}' does not support import mode ${importType}`,
    };
  }

  if (!context.available) {
    return {
      ...base,
      reason: 'provider-unavailable',
      scheduled: false,
      reasonText: `Provider '${options.providerKey}' is not currently available (datasets/API unreachable or credentials missing)`,
    };
  }

  const intervalMs = SCHEDULE_INTERVALS_MS[importType] ?? 24 * 60 * 60 * 1000;
  return {
    ...base,
    reason: 'ok',
    scheduled: true,
    nextRunAt: new Date(now.getTime() + intervalMs).toISOString(),
  };
}
