// [LAYER: CORE]
// @classification PURE

export type ServiceHealthStatus = 'healthy' | 'degraded' | 'critical' | 'stopped';

export interface ServiceHealth {
  name: string;
  status: ServiceHealthStatus;
  started: boolean;
  lastError?: string;
  metrics?: Record<string, number | string | boolean | null>;
}

export type LifecycleState = 'new' | 'started' | 'stopped';

export function lifecycleHealth(
  name: string,
  lifecycleState: LifecycleState,
  options: {
    lastError?: string | null;
    metrics?: Record<string, number | string | boolean | null>;
    degraded?: boolean;
    critical?: boolean;
  } = {}
): ServiceHealth {
  const started = lifecycleState === 'started';
  let status: ServiceHealthStatus;

  if (lifecycleState === 'stopped' || lifecycleState === 'new') {
    status = 'stopped';
  } else if (options.critical) {
    status = 'critical';
  } else if (options.degraded || options.lastError) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    name,
    status,
    started,
    ...(options.lastError ? { lastError: options.lastError } : {}),
    ...(options.metrics ? { metrics: options.metrics } : {}),
  };
}
