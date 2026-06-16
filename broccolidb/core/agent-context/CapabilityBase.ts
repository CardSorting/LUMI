// [LAYER: CORE]
// @classification INTERNAL
import { capabilityHealth, type CapabilityHealth } from './capability-health.js';
import type { IntentTracer } from './IntentTracer.js';
import type { CapabilityName, IntentTracingOptions } from './intent-types.js';

export interface CapabilityObservability {
  callCount: number;
  failureCount: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

export abstract class CapabilityBase {
  abstract readonly name: CapabilityName;
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
    protected readonly isStarted: () => boolean,
    protected readonly intentTracer: IntentTracer
  ) {}

  async health(): Promise<CapabilityHealth> {
    return capabilityHealth(this.name, this.isStarted(), [...this.dependencies], {
      lastError: this.metrics.lastError,
      metrics: {
        callCount: this.metrics.callCount,
        failureCount: this.metrics.failureCount,
        lastSuccessAt: this.metrics.lastSuccessAt,
        lastFailureAt: this.metrics.lastFailureAt,
        intentCount: this.intentTracer.health().perCapabilityIntentCounts[this.name] ?? 0,
      },
    });
  }

  protected async execute<T>(
    operation: string,
    fn: () => Promise<T>,
    tracing: IntentTracingOptions<T> = {}
  ): Promise<T> {
    this.assertStarted(`${this.name}.${operation}`);
    this.metrics.callCount++;

    const fields = this.intentTracer.extractIntentFields(tracing.input);
    const intent = this.intentTracer.createIntent({
      capability: this.name,
      operation,
      inputSummary: tracing.inputSummary ?? {},
      expectedEffects: tracing.expectedEffects ?? [],
      fields,
      priority: tracing.priority,
      durability: tracing.durability,
      timeoutMs: tracing.timeoutMs,
    });
    this.intentTracer.recordStart(intent);

    try {
      const result = await fn();
      this.metrics.lastSuccessAt = Date.now();
      this.metrics.lastError = null;
      this.intentTracer.recordSuccess(
        intent.id,
        tracing.summarizeResult?.(result),
        tracing.expectedEffects
      );
      return result;
    } catch (error) {
      this.metrics.failureCount++;
      this.metrics.lastFailureAt = Date.now();
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      this.intentTracer.recordFailure(intent.id, error);
      throw error;
    }
  }

  protected run<T>(operation: string, fn: () => T, tracing: IntentTracingOptions<T> = {}): T {
    this.assertStarted(`${this.name}.${operation}`);
    this.metrics.callCount++;

    const fields = this.intentTracer.extractIntentFields(tracing.input);
    const intent = this.intentTracer.createIntent({
      capability: this.name,
      operation,
      inputSummary: tracing.inputSummary ?? {},
      expectedEffects: tracing.expectedEffects ?? [],
      fields,
      priority: tracing.priority,
      durability: tracing.durability,
      timeoutMs: tracing.timeoutMs,
    });
    this.intentTracer.recordStart(intent);

    try {
      const result = fn();
      this.metrics.lastSuccessAt = Date.now();
      this.metrics.lastError = null;
      this.intentTracer.recordSuccess(
        intent.id,
        tracing.summarizeResult?.(result),
        tracing.expectedEffects
      );
      return result;
    } catch (error) {
      this.metrics.failureCount++;
      this.metrics.lastFailureAt = Date.now();
      this.metrics.lastError = error instanceof Error ? error.message : String(error);
      this.intentTracer.recordFailure(intent.id, error);
      throw error;
    }
  }
}
