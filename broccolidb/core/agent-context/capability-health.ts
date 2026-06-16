// [LAYER: CORE]
// @classification PURE

export type CapabilityHealthStatus = 'healthy' | 'degraded' | 'critical' | 'stopped';

export interface CapabilityHealth {
  name: string;
  status: CapabilityHealthStatus;
  started: boolean;
  dependencies: string[];
  lastError?: string;
  metrics?: Record<string, number | string | boolean | null>;
}

export function capabilityHealth(
  name: string,
  started: boolean,
  dependencies: string[],
  options: {
    lastError?: string | null;
    metrics?: Record<string, number | string | boolean | null>;
    degraded?: boolean;
    critical?: boolean;
  } = {}
): CapabilityHealth {
  let status: CapabilityHealthStatus;
  if (!started) {
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
    dependencies,
    ...(options.lastError ? { lastError: options.lastError } : {}),
    ...(options.metrics ? { metrics: options.metrics } : {}),
  };
}
