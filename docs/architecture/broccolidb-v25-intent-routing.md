# BroccoliDB v25: Intent Routing

## Thesis

Agents express typed intent. Capabilities validate intent and record traces. Services execute with lifecycle discipline. BufferedDbPool and StorageService absorb durable consequences.

Intent is **not** a queue. It is an observable envelope around capability execution.

## Execution Model

1. Agent calls a capability method (optionally with `correlationId`, `agentId`, `taskId`).
2. Capability validates input at the boundary.
3. `CapabilityBase` creates a `CapabilityIntent` via `IntentTracer`.
4. Trace status `started` is recorded in the in-memory ring buffer.
5. The underlying service/substrate operation runs.
6. Trace status `succeeded` or `failed` is recorded with latency and typed error codes.
7. A typed result is returned to the agent.

## Components

| Component | Role |
|-----------|------|
| `intent-types.ts` | `CapabilityIntent`, `IntentTrace`, priority/durability enums |
| `IntentTracer` | Ring buffer, metrics, optional durable flush via `audit_events` |
| `CapabilityBase` | Automatic intent creation on every `execute()` / `run()` |
| `AuditCapability.traces()` | Read recent traces, filter by `correlationId` |

## Durability Policy

- **Default:** in-memory ring buffer (500 traces).
- **Optional:** `ctx.enableDurableIntentTraces()` then `ctx.flush()` persists completed traces to `audit_events` through `BufferedDbPool` only.
- **Forbidden:** trace files, `trace_queue.db`, `intent_queue.db`, sidecar persistence.

## Correlation IDs

Pass `correlationId` on any capability input that extends `CapabilityIntentFields`:

```ts
await ctx.storage.store({ content, namespace: 'scratchpad', correlationId: 'run-123' });
await ctx.query.search({ text: 'auth flow', limit: 10, correlationId: 'run-123' });
const { traces } = await ctx.audit.traces({ limit: 20, correlationId: 'run-123' });
```

## Health

`ctx.health().intent` reports:

- `recentIntentCount`
- `failedIntentCount`
- `averageIntentLatencyMs`
- `perCapabilityIntentCounts`
- `lastFailedIntent`
- `traceBufferSize`
- `durableMode`

## Forbidden Patterns

- Queues or sidecars for intent delivery
- Direct filesystem trace writes
- Bypassing capabilities to call services
- Silent fallback on trace failures
- Using traces as a persistence bypass for business data
