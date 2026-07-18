---
title: "Completion Lifecycle Decision Engine"
sidebarTitle: "Decision Engine"
description: "Centralized, deterministic completion lifecycle authority with binding action contracts enforced at the tool boundary."
---
{/* [LAYER: INFRASTRUCTURE] */}


# Completion lifecycle decision engine

This document describes the **single deterministic authority** that owns all completion and finalization eligibility decisions, and the **action guard** that enforces those decisions at the tool boundary.

**Principle:** The decision engine determines truth. The action guard enforces truth. The agent only executes the permitted next action.

---

## The spine

Completion eligibility flows through a four-stage spine. Each stage has one job, and agent prose has no authority at any stage.

| Stage | Role | Source file |
|-------|------|-------------|
| **Snapshot builder** | Reads mutable task state once, produces an immutable `CompletionLifecycleSnapshot` frozen at evaluation time | `completionSnapshotBuilder.ts` |
| **Decision engine** | Pure function over the snapshot — returns one canonical `CompletionLifecycleDecision` with a full trace | `CompletionLifecycleDecisionEngine.ts` |
| **Action contract** | The decision carries `nextAllowedAction`, `forbiddenActions`, and a one-line `canonicalInstruction` — the only tool action the agent may execute next | `CompletionLifecycleTypes.ts` |
| **Action guard** | Enforces the contract at the tool boundary — rejects forbidden actions without mutating counters, creating audit state, or triggering retries | `CompletionActionGuard.ts` |

> **The agent receives a command, not a prose explanation to interpret.**

This closes the real failure chain that existed before the spine:

> stale state → ghost audit → wrong interpretation → retry loop → circuit breaker spiral

The spine replaces it with:

> snapshot → decision → permitted action → guard enforcement

That is boring in the exact right way.

---

## Why this exists

Before the decision engine, completion eligibility was scattered across four files:

| File | What it decided independently |
|------|------------------------------|
| `AttemptCompletionHandler.ts` | Fast-path bypass via local audit-validity checks |
| `completionGatePipeline.ts` | Audit cache validity with OR logic (TTL OR graph revision) |
| `attemptCompletionUtils.ts` | Circuit breaker state, duplicate detection, workspace progress |
| `GateLifecycleEvaluator.ts` | Lifecycle state mapping and retry-lock routing |

Each subsystem independently answered the same question — "Is this task allowed to complete?" — using different inputs, different logic, and different cache freshness signals. This produced:

- **Ghost audits**: stale cached audits reused when only one validity dimension matched (OR logic).
- **Retry storms**: duplicate submissions allowed after cooldown, burning through the block budget.
- **Handler-specific bypasses**: the fast-path in `AttemptCompletionHandler` skipped audit re-evaluation based on local checks that didn't match the pipeline's checks.
- **Agent misinterpretation**: the agent received prose error messages and could misread them, hallucinate an audit, retry the wrong tool, or loop despite a canonical trace.

The decision engine solves the first three. The action guard solves the fourth.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Handler (thin adapter)                     │
│  AttemptCompletionHandler / RunFinalizationToolHandler       │
└───────────────┬─────────────────────────────────────────────┘
                │ 1. Collect context (result, taskDescription)
                ▼
┌─────────────────────────────────────────────────────────────┐
│              completionSnapshotBuilder.ts                     │
│  Normalizes TaskConfig/TaskState → immutable snapshot        │
│  (the ONLY place that reads mutable task state for decisions)│
└───────────────┬─────────────────────────────────────────────┘
                │ 2. Immutable CompletionLifecycleSnapshot
                ▼
┌─────────────────────────────────────────────────────────────┐
│           CompletionLifecycleDecisionEngine                   │
│  Pure function: evaluate(snapshot) → decision                │
│  Pipeline: normalize → registry → engineering →              │
│    finalization routing → audit validity (AND) →             │
│    circuit breaker → workspace progress → duplicate →        │
│    decision with binding action contract + full trace         │
└───────────────┬─────────────────────────────────────────────┘
                │ 3. CompletionLifecycleDecision
│                   (kind + nextAllowedAction +
│                    forbiddenActions + canonicalInstruction)
                ▼
┌─────────────────────────────────────────────────────────────┐
│              CompletionActionGuard                            │
│  Validates requested tool against nextAllowedAction          │
│  Rejects forbidden actions — NO counter mutation             │
│  Returns canonical correction (not prose)                    │
└───────────────┬─────────────────────────────────────────────┘
                │ 4. allowed → handler executes
                │    rejected → handler returns correction
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Handler (execution)                        │
│  Preflight checks → audit gate → durable terminal CAS        │
│  → completion emission                                       │
│  (orchestration, persistence, and message formatting only)   │
└─────────────────────────────────────────────────────────────┘
```

### Industry patterns mirrored

| Pattern | Implementation |
|---------|---------------|
| **Finite state machine** | Lifecycle transitions are explicit states with deterministic routing |
| **Circuit breaker / half-open probe** (Hystrix, Envoy) | closed → tripped → half_open (one probe per checkpoint) |
| **CDN cache validation** | All four validity dimensions must match (AND, not OR) |
| **Idempotency-key duplicate suppression** | Canonical SHA-256 `decisionId` + durable `task_completions` row |
| **Compare-and-swap terminalization** | Lease generation + fencing token + task state version under `BEGIN IMMEDIATE` |
| **Single policy engine** | Handlers collect context, engine decides, handlers execute |
| **Capability-based security** | The decision carries a capability token (`nextAllowedAction`) that the guard checks |
| **API gateway authorization** | The guard validates the requested method against the route's allowed methods |
| **Structured decision traces** | Every decision includes a full stage-by-stage trace |
| **Fail-closed for known gates; fail-open for unknown/retired** | Unknown gates are non-participating, not blocking |

---

## File map

| File | Role |
|------|------|
| `src/core/task/tools/completion/CompletionLifecycleTypes.ts` | Types — immutable snapshot input, canonical decision output, action contract, decision trace, gate registry types |
| `src/core/task/tools/completion/CompletionLifecycleDecisionEngine.ts` | **Single deterministic authority** — receives immutable snapshot, returns one canonical decision with full trace and binding action contract |
| `src/core/task/tools/completion/CompletionActionGuard.ts` | **Enforcement layer** — validates requested tool against `nextAllowedAction`, rejects forbidden actions without mutating counters |
| `src/core/task/tools/completion/gateRegistry.ts` | Active/retired gate registry — unknown gates are non-participating |
| `src/core/task/tools/completion/completionSnapshotBuilder.ts` | Adapter — normalizes `TaskConfig`/`TaskState` into immutable snapshot |
| `src/core/task/tools/handlers/AttemptCompletionHandler.ts` | Thin adapter — calls guard, then orchestrates preflight/audit/emission |
| `src/core/task/tools/handlers/RunFinalizationToolHandler.ts` | Thin adapter — calls guard, then delegates to `FinalizationRunner` |
| `src/infrastructure/db/Config.ts` | SQLite `task_completions`, `swarm_locks`, and generation schema |
| `src/core/swarm/SwarmMutexService.ts` | Authoritative lease/generation transactions used by terminal CAS |

---

## The decision engine

### Immutable snapshot input

The engine never reads mutable task state directly. Callers normalize task state into an immutable `CompletionLifecycleSnapshot` before calling `evaluate()`.

Key snapshot fields:

| Field | Purpose |
|-------|---------|
| `checkpointHash` | Workspace fingerprint — changes when files are saved |
| `graphRevision` | Increments on every meaningful state transition |
| `engineeringVerifiedAt` | Latch — set when audit gate passes |
| `finalizationPhase` | `ready` / `running` / `completed` / `failed` |
| `blockCount` | Consecutive gate blocks (circuit breaker input) |
| `lastGateBlockCheckpointHash` | Workspace hash at last block — for progress detection |
| `lastBlockedResultFingerprint` | Result text hash at last block — for duplicate detection |
| `auditCacheKey` | Hash of result + task description + checkpoint hash |
| `auditGraphRevision` | Graph revision when audit was cached |
| `auditCachedAt` | Timestamp when audit was cached |
| `lastProbeCheckpointHash` | Tracks half-open probes — prevents duplicate probes |

### Evaluation pipeline

```
evaluate(snapshot)
  1. Normalize inputs              → trace: task ID, revision, block count
  2. Validate active registry      → trace: gate registry status
  3. Evaluate engineering          → trace: verified or not (determines lane)
  4. Evaluate finalization routing → if verified → route_to_finalization (explicit)
  5. Evaluate audit validity       → strict AND: cache key + graph revision + TTL + gate active
  6. Evaluate circuit breaker      → closed / tripped / half_open
  7. Evaluate workspace progress   → unchanged workspace → soft_block
  8. Evaluate duplicate attempt    → same fingerprint + same workspace → soft_block
  9. Return canonical decision     → one of 5 kinds, with action contract + trace
```

### Decision kinds

| Kind | When | nextAllowedAction | forbiddenActions |
|------|------|-------------------|-----------------|
| `allow_attempt` | All stages passed | `attempt_completion` | `[]` |
| `allow_probe` | Circuit breaker half-open, workspace changed | `attempt_completion` | `[]` |
| `route_to_finalization` | Engineering verified | `run_finalization` | `["attempt_completion"]` |
| `soft_block` | Workspace unchanged or duplicate | `modify_workspace` | `["attempt_completion", "run_finalization"]` |
| `hard_block` | Circuit breaker tripped, workspace unchanged | `stop_and_report` | `["attempt_completion", "run_finalization"]` |

### Canonical instruction

Every decision carries a `canonicalInstruction` — a one-line imperative command, not interpretive prose:

| Decision | canonicalInstruction |
|----------|---------------------|
| `allow_attempt` | `Call attempt_completion now.` |
| `allow_probe` | `Call attempt_completion now. This is a half-open probe — one attempt allowed for this checkpoint.` |
| `route_to_finalization` | `Call run_finalization now. Do not call attempt_completion.` |
| `soft_block` | `Do not call attempt_completion. Modify the workspace (code changes required), then retry.` |
| `hard_block` | `Stop calling attempt_completion. Make workspace changes for a probe attempt, or present results via act_mode_respond.` |

---

## Audit validity — strict AND validation

All four dimensions must hold for the audit to be "valid". Any mismatch invalidates the audit.

```
valid = cacheKeyMatches AND graphRevisionMatches AND ttlValid AND gateActive
```

| Dimension | What it checks | Failure result |
|-----------|---------------|-----------------|
| Cache key | `lastAuditCacheKey === auditCacheKey` (includes checkpoint hash) | `invalidated` |
| Graph revision | `auditGraphRevision === graphRevision` | `invalidated` |
| TTL | `now - auditCachedAt < 5min` | `stale_pending_reconciliation` |
| Gate active | Audit gate in active registry | `not_evaluated` (non-participating) |

**Unknown or retired audit gates** are treated as non-participating — they neither block nor contribute to audit validity. This mirrors service registry patterns (Consul, etcd): deregistered services are non-participating, not blocking.

### Why AND, not OR

The previous implementation used OR logic: `TTL_valid OR graph_revision_match`. This meant a stale audit could be reused when only one condition held. For example, if the TTL was fresh but the graph revision had changed (meaningful state transition), the stale audit was still served — producing a false-positive "passed" result.

The AND logic mirrors CDN cache validation: `ETag` (cache key) + `Last-Modified` (graph revision) + `Cache-Control max-age` (TTL) + origin server healthy (gate active) must ALL match.

---

## Circuit breaker — half-open probe state

Mirrors Netflix Hystrix and Envoy circuit breaker patterns:

| State | Condition | Behavior |
|-------|-----------|----------|
| `closed` | `blockCount < 10` | Normal operation |
| `tripped` | `blockCount >= 10` AND (workspace unchanged OR engineering verified) | Hard block — stop retrying |
| `half_open` | `blockCount >= 10` AND engineering NOT verified AND workspace changed AND no prior probe on this checkpoint | Allow one probe attempt |

### Half-open probe rules

1. Only allowed when the circuit breaker is tripped.
2. Engineering must NOT be verified (verified → route to finalization instead).
3. Workspace checkpoint must have changed since the blocking snapshot.
4. Exactly one probe is allowed per checkpoint — tracked via `lastProbeCheckpointHash` on `TaskState`.
5. A second probe on the same checkpoint is hard-blocked.

This prevents the deadlock where the agent hits the block limit, can't retry (circuit breaker), and can't use `run_finalization` (engineering not verified). The agent makes workspace changes, the circuit breaker opens for one probe, and if the probe passes, engineering is verified and `run_finalization` becomes available.

---

## The action guard

The `CompletionActionGuard` is the enforcement layer at the tool boundary. It ensures the agent cannot execute a forbidden action, regardless of what the agent "thinks" it should do.

### Responsibilities

- Read the latest `CompletionLifecycleDecision`.
- Validate the requested tool against `nextAllowedAction`.
- Reject forbidden actions with a short canonical correction.
- **Never** let invalid agent actions mutate lifecycle counters.
- **Never** let invalid agent actions create new audit state.
- **Never** let invalid agent actions trigger duplicate retry loops.

### How it works

```typescript
// In AttemptCompletionHandler.execute():
const decision = evaluateCompletionLifecycle(config, { result, taskDescription })
const guardResult = guardAttemptCompletion(config, decision)
if (!guardResult.allowed) {
    return guardResult.rejection  // ToolResponse error — no counter mutation
}
// ... proceed with execution ...
```

### Rejection format

Every rejected action includes:
- The `decision.kind` (e.g. `route_to_finalization`)
- The `nextAllowedAction` (e.g. `run_finalization`)
- A one-line correction (the `canonicalInstruction`)

Example rejection:
```
Action "attempt_completion" is not permitted. Decision: route_to_finalization.
Required next action: run_finalization. Call run_finalization now.
Do not call attempt_completion.
```

### What the guard prevents

| Agent action | Decision | Guard result |
|-------------|----------|-------------|
| `attempt_completion` | `route_to_finalization` | **Rejected** — agent must call `run_finalization` |
| `attempt_completion` | `soft_block` | **Rejected** — agent must modify the workspace |
| `attempt_completion` | `hard_block` | **Rejected** — agent must stop and report |
| `run_finalization` | `soft_block` | **Rejected** — finalization not available |
| `run_finalization` | `hard_block` | **Rejected** — finalization not available |
| `attempt_completion` | `allow_attempt` | **Allowed** |
| `attempt_completion` | `allow_probe` | **Allowed** |
| `run_finalization` | `route_to_finalization` | **Allowed** |
| Any non-completion tool | Any decision | **Allowed** (not governed) |

### Counter safety

Rejected actions do NOT:
- Increment `completionGateBlockCount`
- Increment `consecutiveMistakeCount`
- Create or update audit metadata
- Trigger retry loops
- Consume circuit-breaker budget

The guard is side-effect-free on rejection.

---

## Decision trace

Every decision includes a `stages` array showing each evaluated stage, its result, and whether it was decisive. This provides full observability for debugging and testing.

Example trace for a `soft_block` decision:

```
[0] normalize         passed    "Task test-task, revision 3, blocks 2"
[1] registry          passed    "Active gate registry validated"
[2] engineering       n/a       "Not yet verified — completion lane"
[3] audit_validity    n/a       "No audit metadata cached"
[4] circuit_breaker   passed    "Closed (2/10 blocks)"
[5] workspace_progress failed   "Workspace unchanged since last gate block"
[6] decision          failed    "Workspace unchanged — rewording result won't help"
```

---

## Adapter pattern

Handlers do not read task state for eligibility decisions. The flow is:

1. **Handler** collects context (result text, task description).
2. **`buildCompletionSnapshot(config)`** normalizes `TaskConfig`/`TaskState` into an immutable snapshot.
3. **`CompletionLifecycleDecisionEngine.evaluate(snapshot)`** returns one canonical decision.
4. **`CompletionActionGuard`** validates the requested tool against the decision's action contract.
5. **Handler** evaluates preflight/audit and constructs the terminal record.
6. **Terminal CAS** verifies the live lease and unchanged state version, then persists or returns the existing result.
7. **Handler** projects the committed outcome into in-memory state and message output.

This is the ONLY place that reads mutable task state for completion decisions: `completionSnapshotBuilder.ts`.

The decision engine answers whether completion is eligible. It does not itself make the outcome durable. `AttemptCompletionHandler` owns the separate terminalization boundary described below.

---

## Durable terminalization boundary

Completion is not considered terminal merely because evaluation returned success or because in-memory task state changed. The durable source of terminal truth is one SQLite `task_completions` row per task.

### Canonical decision identity

`decisionId` is a SHA-256 digest of recursively sorted canonical JSON with an explicit schema version:

```ts
interface CompletionDecisionIdentityInput {
  taskId: string
  evaluatedStateVersion: number
  checkpoint: string
  outcome: string
  decisionSchemaVersion: number
}
```

The identity excludes incidental JSON insertion order and non-identity metadata. Changing task, state version, checkpoint, outcome, or decision schema changes the digest.

### Transaction contract

The handler uses one `BEGIN IMMEDIATE` transaction to:

1. Read the authoritative `swarm_locks` row for the completion resource.
2. Verify owner ID, lease epoch, fencing token, authority mode, protocol version, and expiry.
3. Verify `swarm_lock_generations` still names the same freshest epoch and token.
4. Re-read the current task state version through the transaction callback and compare it with the evaluated version.
5. Read an existing `task_completions` row, if any.
6. Apply idempotency/conflict rules or insert the terminal row.
7. Commit before updating in-memory terminal state.

Lease epochs and fencing tokens are decimal strings stored as SQLite `TEXT`; the terminal path never narrows them to JavaScript `number`.

### Duplicate and conflict semantics

| Existing durable row | Result |
|----------------------|--------|
| Same `decisionId`, identical payload | Return cached result idempotently |
| Different `decisionId`, same terminal outcome | Return existing result and log duplicate suppression |
| Different terminal outcome | Reject as terminal conflict |
| Same `decisionId`, different payload/checkpoint | Fail closed as corruption or digest collision |

This ordering makes a crash after commit safe: restart reads and returns the terminal row. A crash before commit cannot publish an authoritative terminal outcome. Simultaneous processes serialize at `BEGIN IMMEDIATE`; exactly one row becomes authoritative.

### Database outage

Completion uses the same immutable coordination mode as mutation leases. In production, failure to open or query SQLite raises `DATABASE_AUTHORITY_UNAVAILABLE` with retry class `retry`. It never falls back to in-memory completion state.

---

## Gate registry

The gate registry tracks all gates known to the completion lifecycle system.

| Gate ID | Status | Purpose |
|---------|--------|---------|
| `audit` | active | Hardening audit score gate |
| `roadmap` | active | Roadmap governance gate |
| `focus_chain` | active | Focus chain completeness gate |
| `double_check` | active | Two-step completion verification |
| `quality` | active | Result quality (empty, TODO, tone) |
| `workspace_progress` | active | Workspace-change detection |
| `duplicate` | active | Duplicate submission detection |
| `cooldown` | active | Retry cooldown |
| `demo_command` | active | Demo command validation |
| `legacy_forensic` | retired | Kept for trace clarity, non-participating |

Gates not in the registry are unknown and treated as non-participating. Retired gates are kept in the registry with `status: "retired"` so the engine can distinguish "never existed" from "was retired" in the decision trace.

---

## What changed across the hardening passes

### Pass 1: False-positive prevention (v2.8.1)

- Changed audit cache validity from OR logic to AND logic (TTL AND graph revision, not OR).
- Added `validateWorkspaceProgressSinceGateBlock` soft-block preflight stage.
- Added two-tier `detectDuplicateCompletionSubmission` (within cooldown + after cooldown with workspace check).
- Added circuit breaker half-open probe state.
- Fixed `gateLifecycleInvariants.ts` to import `MAX_COMPLETION_GATE_BLOCK_COUNT` directly (removed fragile local constant).
- Added `deriveAuditValidity` graph revision parameter.

### Pass 2: Centralized decision engine (v2.9.0)

- Created `CompletionLifecycleDecisionEngine` — single deterministic authority.
- Created `CompletionLifecycleTypes.ts` — immutable snapshot input, canonical decision output.
- Created `gateRegistry.ts` — active/retired gate tracking.
- Created `completionSnapshotBuilder.ts` — adapter from `TaskConfig` to snapshot.
- Refactored `isCompletionGateCircuitBreakerTripped()`, `detectDuplicateCompletionSubmission()`, `validateWorkspaceProgressSinceGateBlock()` to delegate to engine.
- Refactored `AttemptCompletionHandler` fast-path and slow-path to use `evaluateCompletionLifecycle()`.
- Added `lastProbeCheckpointHash` to `TaskState`.

### Pass 3: Binding action contract (v2.9.1)

- Added `CompletionNextAction` type and binding action contract fields (`nextAllowedAction`, `forbiddenActions`, `canonicalInstruction`) to every decision.
- Created `CompletionActionGuard` — enforcement layer at the tool boundary.
- Wired guard into `AttemptCompletionHandler.execute()` and `RunFinalizationToolHandler.execute()` as the first gate after parameter validation.
- Removed old `soft_block`/`hard_block` short-circuit from handler's slow path (guard handles this now).
- Every rejected action now includes `decision.kind`, `nextAllowedAction`, and a one-line correction.
- Rejected actions never mutate counters, create audit state, or trigger retries.

### Pass 4: Durable completion CAS terminalization

- Added `task_completions` as the terminal source of truth.
- Added schema-versioned canonical `decisionId` generation.
- Bound terminal commit to the current SQLite owner, epoch, fencing token, protocol, expiry, freshest generation, and task state version.
- Added restart-safe idempotency, same-outcome duplicate suppression, terminal conflict rejection, and collision/corruption detection.
- Preserved arbitrary-precision lease identity as SQLite `TEXT` and TypeScript strings.

---

## Test coverage

| Test file | Tests | Coverage |
|-----------|-------|----------|
| `__tests__/decisionEngine.test.ts` | 28 | All 15 acceptance criteria for the decision engine |
| `__tests__/actionGuard.test.ts` | 21 | Wrong-tool rejection, no counter mutation, deterministic same-snapshot, prose-override prevention |
| `__tests__/falsePositivePrevention.test.ts` | 21 | Circuit breaker half-open, workspace progress, duplicate detection, single-session escape routes |
| `__tests__/completionLifecycleHardening.test.ts` | 21 | Graph revision tracking, no-op retry suppression, breather reconciliation, canonical phase derivation |
| `__tests__/contradictoryStatePrevention.test.ts` | 9 | Contradictory-state invariants on decisions and task state |
| `__tests__/auditInvalidation.test.ts` | 3 | Audit cache reuse, no hidden fallback, checkpoint hash in cache key |
| `__tests__/TaskCompletionTerminalization.test.ts` | focused suite | Canonical digest, restart idempotency, multi-connection contention, stale token/state rejection, bigint precision, DB outage |

Run completion-related tests:

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha \
  --require ts-node/register \
  --require tsconfig-paths/register \
  --require source-map-support/register \
  --require ./src/test/requires.cjs \
  --grep "completion|gate|finalization|audit|decision|action|guard"
```

---

## Related documentation

- [Completion gate lifecycle](completion-gate-lifecycle-migration.md) — Engineering vs finalization lanes, receipt requirements, lifecycle states
- [Parent-thread execution authority](parent-thread-execution-authority.md) — Hot/warm/cold execution model, I/O authority, shift-right gates
- [Governed execution authority](governed-execution-authority.md) — Subagent execution, coordinator authority, seal barrier
