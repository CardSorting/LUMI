# Intent Tracing API

## Overview

Every public capability call produces a typed `CapabilityIntent` and one or more `IntentTrace` records. Agents do not construct intents manually unless using advanced introspection.

## Reading Traces

```ts
await ctx.start();

await ctx.storage.store({
  content: payload,
  namespace: 'scratchpad',
  correlationId: 'run-123',
});

const { traces } = await ctx.audit.traces({
  limit: 20,
  correlationId: 'run-123',
});

for (const trace of traces) {
  console.log(trace.capability, trace.operation, trace.status, trace.latencyMs);
}

await ctx.stop();
```

## Trace Shape

```ts
type IntentTrace = {
  intentId: string;
  correlationId?: string;
  capability: string;
  operation: string;
  status: 'started' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt?: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
  substrateEffects?: string[];
  persisted?: boolean;
};
```

## Optional Intent Fields

Add to any capability input:

| Field | Type | Purpose |
|-------|------|---------|
| `correlationId` | `string` | Tie related capability calls together |
| `agentId` | `string` | Attribution |
| `taskId` | `string` | Task scope |
| `priority` | `low \| normal \| high \| critical` | Intent metadata |
| `durability` | `ephemeral \| buffered \| durable` | Intent metadata |
| `timeoutMs` | `number` | Declared timeout budget |
| `metadata` | `Record<string, unknown>` | Opaque diagnostic tags |

## Durable Traces

```ts
ctx.enableDurableIntentTraces();
await ctx.storage.store({ content: 'x' });
await ctx.flush(); // persists completed traces via BufferedDbPool → audit_events
```

Traces are never written to standalone files or queue databases.

## Health Metrics

```ts
const health = await ctx.health();
console.log(health.intent.failedIntentCount);
console.log(health.intent.perCapabilityIntentCounts);
```

## Errors

Failed capability calls produce traces with typed `errorCode` values from `AgentGitError` (e.g. `INVALID_ARGUMENT`, `LIFECYCLE_STATE_ERROR`).
