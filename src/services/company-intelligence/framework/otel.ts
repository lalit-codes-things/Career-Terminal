/**
 * Provider observability — OpenTelemetry hook seam.
 *
 * The framework emits structured observability events at every lifecycle
 * transition (register, initialize, import, health check, shutdown). A hook
 * can be installed to forward these events to an OpenTelemetry tracer / metrics
 * exporter. No OpenTelemetry dependency is required at this layer: install a
 * hook only when a collector is wired in a later epic.
 *
 * Hooks must never break the pipeline — all hook failures are swallowed.
 */

export type ProviderObservabilityEventType =
  | 'registered'
  | 'unregistered'
  | 'enabled'
  | 'disabled'
  | 'initialized'
  | 'initialize_failed'
  | 'shutdown'
  | 'import_started'
  | 'import_completed'
  | 'import_failed'
  | 'health_checked';

export interface ProviderObservabilityEvent {
  type: ProviderObservabilityEventType;
  providerKey: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

export interface ProviderObservabilityHook {
  onProviderEvent(event: ProviderObservabilityEvent): void;
}

const NOOP_HOOK: ProviderObservabilityHook = {
  onProviderEvent: () => {},
};

let activeHook: ProviderObservabilityHook = NOOP_HOOK;

/** Install the observability hook (e.g. an OpenTelemetry forwarder). */
export function setProviderObservabilityHook(hook: ProviderObservabilityHook | null): void {
  activeHook = hook ?? NOOP_HOOK;
}

/** Emit a provider observability event. Never throws. */
export function emitProviderEvent(event: ProviderObservabilityEvent): void {
  try {
    activeHook.onProviderEvent(event);
  } catch {
    // Observability must never affect the provider pipeline.
  }
}
