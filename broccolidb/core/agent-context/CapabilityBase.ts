// [LAYER: CORE]
// @classification INTERNAL
import { capabilityHealth, type CapabilityHealth } from './capability-health.js';

export interface CapabilityObservability {
  callCount: number;
  failureCount: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

export abstract class CapabilityBase {
  abstract readonly name: string;
  abstract readonly dependencies: readonly string[];

  private readonly metrics: CapabilityObservability = {
    callCount: 0,
    failureCount: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
  };

  constructor(
    protected readonly assertStarted: (operation: string) => void,
    protected readonly isStarted: () => boolean
  ) {}

  async health(): Promise<CapabilityHealth> {
    return capabilityHealth(this.name, this.isStarted(), [...this.dependencies], {
      lastError: this.metrics.lastError,
      metrics: {
        callCount: this.metrics.callCount,
        failureCount: this.metrics.failureCount,
        lastSuccessAt: this.metrics.lastSuccessAt,
        lastFailureAt: this.metrics.lastFailureAt,
      },
    });
  }

  protected async execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    this.assertStarted(`${this.name}.${operation}`);
    this.metrics.callCount++;
    try {
      const result = await fn();
      this.metrics.lastSuccessAt = Date.now();
      this.metrics.lastError = null;
      return result;
    } catch (error) {
      this.metrics.failureCount++;
      this.metrics.lastFailureAt = Date.now();
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  protected run<T>(operation: string, fn: () => T): T {
    this.assertStarted(`${this.name}.${operation}`);
    this.metrics.callCount++;
    try {
      const result = fn();
      this.metrics.lastSuccessAt = Date.now();
      this.metrics.lastError = null;
      return result;
    } catch (error) {
      this.metrics.failureCount++;
      this.metrics.lastFailureAt = Date.now();
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}
