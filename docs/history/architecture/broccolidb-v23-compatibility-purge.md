# BroccoliDB v23: Compatibility Purge

## Doctrine

Backward compatibility that preserves architectural drift is forbidden. `AgentContext` is a lifecycle-owned capability façade — not an API landfill.

Agents receive **named capabilities** with explicit lifecycle guards, typed errors, and substrate routing. Legacy bridges, deprecated aliases, and raw service getters are removed.

## Removed public API

The following `AgentContext` surface is **gone**:

| Removed | Replacement |
|---------|-------------|
| `ctx.store()` / `ctx.hydrate()` | `ctx.storage.store()` / `ctx.storage.hydrate()` |
| `ctx.recordTelemetry()` | `ctx.telemetry.record()` |
| `ctx.recover()` | `ctx.recovery.recover({ mode: 'standard' })` |
| `ctx.snapshot()` | `ctx.snapshots.create()` |
| `ctx.auditInvariants()` | `ctx.audit.invariants()` |
| `ctx.db` | Use capabilities (never raw pool) |
| `ctx.pasteStore` | `ctx.storage` |
| `ctx.shutdown()` / `ctx.dispose()` | `ctx.stop()` |
| `ctx.graphService` / `ctx.graph` (raw service) | `ctx.graph.*` capability |
| `ctx.reasoningService` | `ctx.reasoning.*` |
| `ctx.taskService` / `ctx.tasks` (raw service) | `ctx.tasks.*` |
| `ctx.mutex` / `ctx.cleanup` / `ctx.lsp` / `ctx.spider` | `ctx.coordination.*`, `ctx.recovery.*`, `ctx.graph.spider.*` |
| All knowledge/reasoning/task bridge methods on `AgentContext` | Matching capability methods |

## Allowed public API

`AgentContext` exposes **only**:

- Lifecycle: `start()`, `stop()`, `flush()`, `health()`
- Identity: `userId`
- Capability getters: `storage`, `telemetry`, `recovery`, `audit`, `coordination`, `query`, `snapshots`, `graph`, `reasoning`, `tasks`, `scratchpad`, `mailbox`

## Target usage

```typescript
const ctx = new AgentContext(workspace, pool, userId);
await ctx.start();

await ctx.storage.store(content);
await ctx.storage.hydrate(hash);
await ctx.telemetry.record({ usage: { promptTokens: 1, completionTokens: 2 } });
await ctx.query.search('auth middleware');
await ctx.snapshots.create({ label: 'pre-migration' });
await ctx.recovery.recover({ mode: 'standard' });
const violations = await ctx.audit.invariants();
await ctx.graph.addKnowledge('node-1', 'fact', '...');
await ctx.reasoning.detectContradictions('node-1');
await ctx.tasks.spawn(taskId, agentId, description);
await ctx.flush();
await ctx.stop();
```

## Migration examples

### Storage

```typescript
// before
const hash = await ctx.store(payload);
const text = await ctx.hydrate(hash);

// after
const hash = await ctx.storage.store(payload);
const text = await ctx.storage.hydrate(hash);
```

### Reasoning / graph

```typescript
// before
await ctx.addKnowledge(id, 'fact', content);
const reports = await ctx.detectContradictions(id);

// after
await ctx.graph.addKnowledge(id, 'fact', content);
const reports = await ctx.reasoning.detectContradictions(id);
```

### Structural spider

```typescript
// before
await ctx.spider.bootstrapGraph();
const impact = ctx.getStructuralImpact(path);

// after
await ctx.graph.spider.bootstrapGraph();
const impact = ctx.graph.getStructuralImpact(path);
```

## Forbidden patterns

- `TRANSITIONAL_BRIDGE` symbols (unless listed in `compatibility-purge.ts` with a `deletionDate`)
- Public getters for raw `BufferedDbPool`, `StorageService`, or internal services
- Capability modules that construct owned services or call `LifecycleRegistry` directly
- Direct filesystem CAS writes outside `StorageService`
- Direct SQL / `better-sqlite3` outside `BufferedDbPool` / repository layer
- `shutdown()`, `pasteStore`, or deprecated aliases on `AgentContext`

## Compatibility exceptions

`core/agent-context/compatibility-purge.ts` exports `COMPATIBILITY_EXCEPTIONS`. The list must be **empty** for a clean build. Any temporary exception requires:

```typescript
{ symbol: '...', reason: '...', deletionDate: 'YYYY-MM-DD' }
```

Guardrail tests fail if exceptions exist without `deletionDate`.

## Health model

`ctx.health()` returns:

- Substrate / owned-service health (`registry`)
- Per-capability health (`capabilities`)
- Deep invariant violations (`invariantViolations`)
- Compatibility bridge violations (`compatibilityBridgeViolations`)

## Error policy

Public capability methods throw typed errors only:

- `LifecycleStateError` — before `start()` or after `stop()`
- `RecoveryError`, `StorageIntegrityError`, `InvariantViolationError`
- `BackpressureError`, `FlushTimeoutError`, `DatabaseLockError`

No generic `Error` for known substrate failure modes.

## Final doctrine

`core/agent-context` coordinates capabilities; it does not recreate persistence, storage, or recovery outside the substrate. Compatibility sediment is debt — v23 pays it down.
