// [LAYER: CORE]
// @classification INTERNAL
import * as crypto from 'node:crypto';
import type { BufferedDbPool } from '../../infrastructure/db/BufferedDbPool.js';
import { AgentGitError } from '../errors.js';
import type {
  CapabilityIntent,
  CapabilityIntentFields,
  CapabilityName,
  IntentTrace,
  IntentTracerHealth,
} from './intent-types.js';

const DEFAULT_BUFFER_SIZE = 500;

export class IntentTracer {
  private readonly buffer: IntentTrace[] = [];
  private readonly intents = new Map<string, CapabilityIntent>();
  private readonly activeStarts = new Map<string, number>();
  private readonly perCapabilityCounts = new Map<string, number>();
  private totalIntents = 0;
  private failedIntents = 0;
  private completedIntents = 0;
  private totalLatencyMs = 0;
  private lastFailedIntent: IntentTrace | undefined;
  private durableMode = false;
  private readonly persistedIntentIds = new Set<string>();

  constructor(
    private readonly userId: string,
    private readonly db?: BufferedDbPool
  ) {}

  enableDurableMode(): void {
    this.durableMode = true;
  }

  isDurableModeEnabled(): boolean {
    return this.durableMode;
  }

  extractIntentFields(input: unknown): CapabilityIntentFields {
    if (!input || typeof input !== 'object') return {};
    const obj = input as Record<string, unknown>;
    const fields: CapabilityIntentFields = {};
    if (typeof obj.correlationId === 'string' && obj.correlationId.trim()) {
      fields.correlationId = obj.correlationId.trim();
    }
    if (typeof obj.agentId === 'string' && obj.agentId.trim()) {
      fields.agentId = obj.agentId.trim();
    }
    if (typeof obj.taskId === 'string' && obj.taskId.trim()) {
      fields.taskId = obj.taskId.trim();
    }
    if (obj.priority === 'low' || obj.priority === 'normal' || obj.priority === 'high' || obj.priority === 'critical') {
      fields.priority = obj.priority;
    }
    if (obj.durability === 'ephemeral' || obj.durability === 'buffered' || obj.durability === 'durable') {
      fields.durability = obj.durability;
    }
    if (typeof obj.timeoutMs === 'number' && Number.isFinite(obj.timeoutMs)) {
      fields.timeoutMs = obj.timeoutMs;
    }
    if (obj.metadata && typeof obj.metadata === 'object') {
      fields.metadata = obj.metadata as Record<string, unknown>;
    }
    return fields;
  }

  createIntent(params: {
    capability: CapabilityName;
    operation: string;
    inputSummary: Record<string, unknown>;
    expectedEffects: string[];
    fields?: CapabilityIntentFields;
    priority?: CapabilityIntent['priority'];
    durability?: CapabilityIntent['durability'];
    timeoutMs?: number;
  }): CapabilityIntent {
    const fields = params.fields ?? {};
    const intent: CapabilityIntent = {
      id: crypto.randomUUID(),
      kind: params.capability,
      capability: params.capability,
      operation: params.operation,
      createdAt: Date.now(),
      inputSummary: params.inputSummary,
      priority: fields.priority ?? params.priority ?? 'normal',
      durability: fields.durability ?? params.durability ?? 'buffered',
      expectedEffects: params.expectedEffects,
      ...(fields.agentId ? { agentId: fields.agentId } : {}),
      ...(fields.taskId ? { taskId: fields.taskId } : {}),
      ...(fields.correlationId ? { correlationId: fields.correlationId } : {}),
      ...(fields.timeoutMs ?? params.timeoutMs ? { timeoutMs: fields.timeoutMs ?? params.timeoutMs } : {}),
      ...(fields.metadata ? { metadata: fields.metadata } : {}),
    };
    this.intents.set(intent.id, intent);
    this.totalIntents++;
    this.perCapabilityCounts.set(
      intent.capability,
      (this.perCapabilityCounts.get(intent.capability) ?? 0) + 1
    );
    return intent;
  }

  recordStart(intent: CapabilityIntent): IntentTrace {
    const startedAt = Date.now();
    this.activeStarts.set(intent.id, startedAt);
    const trace: IntentTrace = {
      intentId: intent.id,
      correlationId: intent.correlationId,
      capability: intent.capability,
      operation: intent.operation,
      status: 'started',
      startedAt,
    };
    this.pushTrace(trace);
    return trace;
  }

  recordSuccess(
    intentId: string,
    resultSummary?: Record<string, unknown>,
    substrateEffects?: string[]
  ): IntentTrace {
    const startedAt = this.activeStarts.get(intentId) ?? Date.now();
    const finishedAt = Date.now();
    const intent = this.intents.get(intentId);
    const trace: IntentTrace = {
      intentId,
      correlationId: intent?.correlationId,
      capability: intent?.capability ?? 'storage',
      operation: intent?.operation ?? 'unknown',
      status: 'succeeded',
      startedAt,
      finishedAt,
      latencyMs: finishedAt - startedAt,
      resultSummary,
      substrateEffects: substrateEffects ?? intent?.expectedEffects,
    };
    this.completedIntents++;
    this.totalLatencyMs += trace.latencyMs ?? 0;
    this.activeStarts.delete(intentId);
    this.pushTrace(trace);
    return trace;
  }

  recordFailure(intentId: string, error: unknown): IntentTrace {
    const startedAt = this.activeStarts.get(intentId) ?? Date.now();
    const finishedAt = Date.now();
    const intent = this.intents.get(intentId);
    const errorCode = error instanceof AgentGitError ? error.code : 'UNKNOWN';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const trace: IntentTrace = {
      intentId,
      correlationId: intent?.correlationId,
      capability: intent?.capability ?? 'storage',
      operation: intent?.operation ?? 'unknown',
      status: 'failed',
      startedAt,
      finishedAt,
      latencyMs: finishedAt - startedAt,
      errorCode,
      errorMessage,
      substrateEffects: intent?.expectedEffects,
    };
    this.failedIntents++;
    this.lastFailedIntent = trace;
    this.activeStarts.delete(intentId);
    this.pushTrace(trace);
    return trace;
  }

  recent(limit: number, filter?: { correlationId?: string }): IntentTrace[] {
    let traces = [...this.buffer];
    if (filter?.correlationId) {
      traces = traces.filter((trace) => trace.correlationId === filter.correlationId);
    }
    return traces.slice(-limit).reverse();
  }

  async flush(): Promise<number> {
    if (!this.durableMode || !this.db) return 0;

    let persisted = 0;
    for (const trace of this.buffer) {
      if (trace.status === 'started' || trace.persisted || this.persistedIntentIds.has(trace.intentId)) {
        continue;
      }
      await this.db.push({
        type: 'insert',
        table: 'audit_events',
        values: {
          id: crypto.randomUUID(),
          userId: this.userId,
          agentId: null,
          type: 'intent_trace',
          data: JSON.stringify(trace),
          createdAt: trace.finishedAt ?? trace.startedAt,
        },
      });
      trace.persisted = true;
      this.persistedIntentIds.add(trace.intentId);
      persisted++;
    }
    return persisted;
  }

  health(): IntentTracerHealth {
    const perCapabilityIntentCounts: Record<string, number> = {};
    for (const [capability, count] of this.perCapabilityCounts.entries()) {
      perCapabilityIntentCounts[capability] = count;
    }
    return {
      recentIntentCount: this.totalIntents,
      failedIntentCount: this.failedIntents,
      averageIntentLatencyMs:
        this.completedIntents > 0 ? Math.round(this.totalLatencyMs / this.completedIntents) : 0,
      perCapabilityIntentCounts,
      ...(this.lastFailedIntent ? { lastFailedIntent: this.lastFailedIntent } : {}),
      traceBufferSize: this.buffer.length,
      durableMode: this.durableMode,
    };
  }

  private pushTrace(trace: IntentTrace): void {
    this.buffer.push(trace);
    if (this.buffer.length > DEFAULT_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }
}
