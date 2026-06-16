# Public API (v30 frozen)

The npm package `@noorm/broccolidb` exports **only** symbols listed in [`core/public-api.ts`](../core/public-api.ts). Everything else is internal.

Guardrail: `tests/public-api-snapshot.test.ts` enforces the allowlist.

## AgentContext lifecycle

```typescript
const ctx = new AgentContext(workspace, db?, userId?);
await ctx.start();
await ctx.stop();
await ctx.flush();
const health = await ctx.health({ deep?: boolean });
```

| Method | Description |
|--------|-------------|
| `start()` | Start registry (db, storage, orchestration, …) |
| `stop()` | Shut down; context cannot be restarted |
| `flush()` | Flush durable writes (db, intent traces) |
| `health()` | Lifecycle + per-capability health |

## Capability getters

| Getter | Purpose |
|--------|---------|
| `ctx.query` | Knowledge search, structural impact |
| `ctx.graph` | Graph traversal; **Spider** at `ctx.graph.spider` |
| `ctx.runtime` | Sessions, plans, execution, verification, state views |
| `ctx.audit` | Invariant checks |
| `ctx.storage` | Blob storage (CAS) |
| `ctx.snapshots` | Context snapshots |
| `ctx.recovery` | Recovery operations |
| `ctx.telemetry` | Telemetry events |
| `ctx.coordination` | Mutex and agent coordination |
| `ctx.reasoning` | Reasoning chains |
| `ctx.tasks` | Task board |
| `ctx.scratchpad` | Agent scratchpad |
| `ctx.mailbox` | Inter-agent mailbox |

## Runtime (`ctx.runtime`)

### Sessions

```typescript
const session = await ctx.runtime.beginSession({
  taskId: 'my-task',
  budget: { maxDirectives: 10 },
});
```

### Repair pipeline

| Method | Description |
|--------|-------------|
| `recordAudit(sessionId, audit)` | Link Spider report to session graph |
| `recordGate(sessionId, exitCode, reportId?)` | Record gate outcome |
| `planRepairs({ audit, sessionId, policy? })` | Build `MutationPlan` |
| `preview(plan, policy)` | Human-readable preview + policy decision |
| `execute({ plan, policy? })` | Apply repairs (sole file mutation path) |
| `verify({ sessionId, executionId? })` | Run verification pipeline |

### Operator views

| Method | Description |
|--------|-------------|
| `state(sessionId)` | Session summary from RuntimeStateGraph |
| `timeline(sessionId)` | Ordered event timeline |
| `explain(sessionId, nodeId?)` | Causal explanation |
| `nextActions(sessionId)` | Suggested next steps |
| `blockers(sessionId?)` | Open blockers |
| `openLoops(sessionId)` | Unresolved loops |
| `causalView(sessionId)` | Causal chains |
| `diffView(sessionId)` | Graph diff |
| `export(sessionId, { format })` | `json`, `markdown`, or `sarif` |

### Durable memory

| Method | Description |
|--------|-------------|
| `await snapshot(sessionId)` | Persist RuntimeStateGraph (integrity-checked) |
| `story(sessionId)` | Human narrative |
| `await replay(sessionId, { mode?, snapshotId? })` | Forensic replay (readonly) |
| `getMemoryHealth()` | Graph integrity, snapshot count |
| `getRuntimeHealth()` | Active sessions, budgets, policy state |
| `setMode(mode)` | `development` \| `ci` \| `production` \| `readonly` \| `recovery` \| `forensic` |

Persisted snapshots reload automatically when a new `AgentContext` starts against the same database.

## Spider (`ctx.graph.spider`)

Access Spider **only** through this capability facet.

| Method | Description |
|--------|-------------|
| `audit(options?)` | Full structural audit (read-only) |
| `gate(options?)` | CI-style pass/fail gate |
| `check(request)` | Unified phase check (`pre-edit`, `ci`, …) |
| `formatCheckDigest(result)` | Compact CI digest |
| `gateBundle(options?)` | Gate + agent bundle |
| `planRepairs` / `execute` | **Not here** — use `ctx.runtime` |

## Exported types

Capability types, intent types, runtime session types, `MutationPlan`, `VerificationResult`, `RuntimeSnapshot`, `RuntimeStory`, `ReplayMode`, and policy error classes are exported from `public-api.ts`.

## Exported errors

| Class | Code (typical) |
|-------|----------------|
| `GuidedError` / `LifecycleStateError` | `LIFECYCLE_STATE_ERROR` |
| `PolicyBlockedError` | policy-specific |
| `RuntimeBudgetExceededError` | `BUDGET_EXCEEDED` |
| `RuntimePolicyViolationError` | mode violation |
| `InvariantViolationError` | `INVARIANT_VIOLATION` |
| `AgentGitError` | base class with `code` |

See [errors.md](errors.md).

## Bootstrap helpers

Exported for scripts and CLI:

- `Workspace` — workspace + repository access
- `Connection` — database connection wrapper

## Classifications

| Label | Meaning |
|-------|---------|
| **STABLE** | In `public-api.ts`; semver applies |
| **INTERNAL** | Under `core/**` not re-exported |
| **DEPRECATED** | See [MIGRATION.md](../MIGRATION.md) |
| **FORBIDDEN** | Bypassing capabilities or lifecycle |

Full policy: [API_STABILITY.md](../API_STABILITY.md).
