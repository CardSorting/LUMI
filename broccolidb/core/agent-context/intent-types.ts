// [LAYER: CORE]
// @classification PURE

export type CapabilityName =
  | 'storage'
  | 'telemetry'
  | 'recovery'
  | 'audit'
  | 'coordination'
  | 'query'
  | 'snapshots'
  | 'graph'
  | 'reasoning'
  | 'tasks'
  | 'scratchpad'
  | 'mailbox';

export type IntentPriority = 'low' | 'normal' | 'high' | 'critical';
export type IntentDurability = 'ephemeral' | 'buffered' | 'durable';
export type IntentTraceStatus = 'started' | 'succeeded' | 'failed';

export interface CapabilityIntentFields {
  correlationId?: string;
  agentId?: string;
  taskId?: string;
  priority?: IntentPriority;
  durability?: IntentDurability;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CapabilityIntent {
  id: string;
  kind: CapabilityName;
  capability: CapabilityName;
  operation: string;
  createdAt: number;
  agentId?: string;
  taskId?: string;
  correlationId?: string;
  inputSummary: Record<string, unknown>;
  priority: IntentPriority;
  durability: IntentDurability;
  expectedEffects: string[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export type StorageIntent = CapabilityIntent & { kind: 'storage' };
export type TelemetryIntent = CapabilityIntent & { kind: 'telemetry' };
export type RecoveryIntent = CapabilityIntent & { kind: 'recovery' };
export type AuditIntent = CapabilityIntent & { kind: 'audit' };
export type CoordinationIntent = CapabilityIntent & { kind: 'coordination' };
export type QueryIntent = CapabilityIntent & { kind: 'query' };
export type SnapshotIntent = CapabilityIntent & { kind: 'snapshots' };
export type GraphIntent = CapabilityIntent & { kind: 'graph' };
export type ReasoningIntent = CapabilityIntent & { kind: 'reasoning' };
export type TaskIntent = CapabilityIntent & { kind: 'tasks' };
export type ScratchpadIntent = CapabilityIntent & { kind: 'scratchpad' };
export type MailboxIntent = CapabilityIntent & { kind: 'mailbox' };

export type CapabilityIntentUnion =
  | StorageIntent
  | TelemetryIntent
  | RecoveryIntent
  | AuditIntent
  | CoordinationIntent
  | QueryIntent
  | SnapshotIntent
  | GraphIntent
  | ReasoningIntent
  | TaskIntent
  | ScratchpadIntent
  | MailboxIntent;

export interface IntentTrace {
  intentId: string;
  correlationId?: string;
  capability: string;
  operation: string;
  status: IntentTraceStatus;
  startedAt: number;
  finishedAt?: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  inputSummary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  substrateEffects?: string[];
  persisted?: boolean;
}

export interface IntentTracerHealth {
  recentIntentCount: number;
  failedIntentCount: number;
  averageIntentLatencyMs: number;
  perCapabilityIntentCounts: Record<string, number>;
  lastFailedIntent?: IntentTrace;
  traceBufferSize: number;
  durableMode: boolean;
}

export interface IntentTracingOptions<T = unknown> {
  input?: unknown;
  inputSummary?: Record<string, unknown>;
  expectedEffects?: string[];
  priority?: IntentPriority;
  durability?: IntentDurability;
  timeoutMs?: number;
  summarizeResult?: (result: T) => Record<string, unknown>;
}

export interface AuditTracesInput extends CapabilityIntentFields {
  limit?: number;
  correlationId?: string;
}

export interface AuditTracesResult {
  traces: IntentTrace[];
}
