---
title: "Governed Execution Authority"
sidebarTitle: "Execution Authority"
description: "SQLite-backed live authority, projection-safe reconciliation, deadlock prevention, and durable completion for governed swarms."
---

# Governed execution authority

Runtime receipts are **observational artifacts**, not canonical live execution state.

Agents and operators must never treat the following as **independent authority** to halt, block, escalate, deny retry, finalize, or invalidate execution:

- receipts
- audit entries
- retry markers
- gate snapshots
- verification outputs
- reconciliation traces

These artifacts exist to:

- explain behavior
- support recovery
- aid debugging
- provide continuity
- preserve forensic history

They do **not** alone authorize halting, blocking, escalation, retry denial, task finalization, or execution invalidation.

Related:

| Doc | Topic |
|-----|--------|
| [Governed subagent execution](governed-subagent-execution.md) | Swarm architecture |
| [Governed execution runbook](governed-execution-runbook.md) | Authoritative state procedure |
| [Parent-thread execution authority](parent-thread-execution-authority.md) | Hot/warm/cold parent gates |
| [Governed execution decisions § ADR-001/015](governed-execution-decisions.md) | Locks, receipts, coordinator authority |

---

## Core principle

> **Locks protect mutation. Receipts preserve forensic truth. The coordinator owns live authority.**

ADR-001 (*receipts preserve truth*) means durable **history** — what happened, for merge and replay. ADR-015 (*this document*) means receipts are **not** the live source of truth for whether work may continue **right now**. Only the coordinator/runtime authority layer decides that.

---

## Authority hierarchy

### Canonical authority

Only the **coordinator / runtime authority layer** may determine:

- execution state
- task ownership
- finalization legitimacy
- mutation approval
- recovery validity
- continuation eligibility

Implementation anchors:

| Concern | Canonical source |
|---------|------------------|
| Production mutation lease | SQLite `swarm_locks` + `swarm_lock_generations` through `SwarmMutexService` |
| Swarm merge / seal | `GovernedSwarmCoordinator` + `MergeGate` |
| Authoritative receipt | Last `sealed && mergePassed` in `.governed.history.jsonl` ([runbook procedure](governed-execution-runbook.md#authoritative-state-procedure)) |
| Parent completion eligibility | Completion lifecycle decision engine and action guard |
| Parent terminal result | SQLite `task_completions` row committed by the completion CAS transaction |
| Workspace roadmap truth | Coordinator `commitWorkspaceRoadmapPatches` after reconciliation |

### Coordination authority modes

Coordination mode is fixed at startup:

| Mode | Intended use | Authority |
|------|--------------|-----------|
| `sqlite` | Production and durable local execution | SQLite is the only lease and fencing authority |
| `local_test` | Explicit unit-test/local harnesses | In-memory claims only; never selected dynamically after a database failure |

Records carry their `authorityMode`. A runtime rejects records from the other mode instead of translating or adopting them. In `sqlite` mode, a connection or query failure raises `DATABASE_AUTHORITY_UNAVAILABLE` with retry class `retry`; execution retries at a safe boundary or fails closed. Memory and filesystem state never become substitute authority.

### Lease transaction order

Production acquisition and release have asymmetric, intentional order:

1. Roadmap admission may reject the request before ownership is attempted.
2. `BEGIN IMMEDIATE` allocates a new `leaseEpoch` and `fencingToken` and persists the SQLite lease.
3. File, Broccoli, and in-process projections are created from that exact durable identity.
4. A projection failure triggers an ownership-checked SQLite release and exact projection cleanup.
5. Release first deletes the SQLite row by `resource + ownerId + leaseEpoch + fencingToken`.
6. Only after the database transition commits are matching projections removed. Cleanup failures are logged and repaired later; they never restore the released database lease.

`leaseEpoch` and `fencingToken` are decimal strings backed by JavaScript `bigint` and SQLite `TEXT`. Do not parse them through `number`.

### Subagent and lane role

Subagents may:

- observe
- recommend
- annotate
- challenge
- propose corrections

Subagents may **not** independently freeze execution using receipts alone.

---

## Receipt handling rules

### Receipts are advisory for live decisions

Treat receipts as potentially:

- stale
- partially ordered
- context incomplete
- replayed
- duplicated
- generated from superseded runtime snapshots

A receipt may indicate:

- historical observation
- prior uncertainty
- temporary blockage (at time of write)
- failed reconciliation (at time of write)
- outdated governance state
- incomplete execution context

**Before acting on a receipt-shaped signal**, the runtime must verify **current** authoritative coordinator state.

Operator example: chat status and `{swarmId}.governed.json` latest pointer can lie after a failed retry — scan history bottom-up for sealed success ([runbook](governed-execution-runbook.md#authoritative-state-procedure)).

---

## Deadlock prevention rules

The system must **never halt solely** because:

- a receipt claims blockage
- an audit gate failed previously
- a subagent reported uncertainty
- a retry path escalated caution
- a stale reconciliation artifact exists

Before blocking execution:

1. Re-evaluate current authoritative coordinator state.
2. Capture an immutable scheduler snapshot and its state version.
3. Build typed wait edges for lane dependencies, resource ownership, timers, and capacity.
4. Run Tarjan SCC detection over hard dependency and ownership edges.
5. Treat an SCC as deadlocked only when it has no edge-resolving escape transition.
6. Re-confirm scheduler and lane versions before applying recovery.

Valid escapes include a pending timer, an expiring resource lease, an outside running owner that can release a resource without waiting on the SCC, and unrelated capacity holders that can free a pool slot. Capacity contention and backoff are therefore not deadlocks. A changed snapshot invalidates the diagnosis; the coordinator recomputes instead of applying stale recovery.

### Mapping to implementation (parent-thread shift-right)

| Anti-pattern | Mitigation |
|--------------|------------|
| Duplicate guard preflight | Single `ToolExecutor` guard ownership |
| Per-lane blocking `auditTask` | Deferred to parent seal barrier |
| Receipt-driven inner-loop block | I/O authority hot path; audits advisory until `attempt_completion` |
| Recursive validation without progress | Soft cooldown/duplicate preflight; 5-min audit cache-aside |

See [parent-thread execution authority](parent-thread-execution-authority.md).

### Mapping to implementation (receipt authority refactor)

| Concern | Module | Behavior |
|---------|--------|----------|
| Coordinator halt reconciliation | `CoordinatorExecutionAuthority.ts` | `evaluateCoordinatorHaltDecision` — receipts/audit preflight cannot halt without live coordinator confirmation |
| Authoritative vs latest receipt | `resolvePriorSealedReceiptForMerge` + `loadAuthoritativeGovernedReceipt` | Merge gate uses sealed history, not stale latest pointer |
| Seal preflight downgrade | `classifyPreflightIssuesForSeal` | All seal-time preflight issues recorded as `info` advisory |
| Supersession / lineage retry | `GovernedSwarmCoordinator.sealReceipt` | Coordinator reconciles `sealedSupersessionBlocked` before blocking |
| Progress paralysis telemetry | `GovernanceParalysisTracker` | Emits `governance_recursion_detected`, `no_progress_execution_loop` on completion gate blocks |
| Subagent parent signals | `auditSubagentContext.ts` | Parent gate signals prefixed `ADVISORY:` — forensic handoff only |
| Diagnostics surface | `TaskState.governanceDiagnostics`, `GovernedAuditIntegration.governanceDiagnostics` | Structured codes for operator triage |

Diagnostic codes (`@shared/subagent/coordinatorAuthority.ts`):

- `governance_recursion_detected`
- `duplicate_audit_path_detected`
- `stale_receipt_authority_detected`
- `no_progress_execution_loop`

---

## Throughput hardening pass

Three-tier blocker policy (`@shared/subagent/blockerPolicy.ts`):

| Tier | May halt? | Examples |
|------|-----------|----------|
| **Hard** | Yes — coordinator-confirmed | split-brain, unreleased claims, replay mismatch |
| **Soft** | No — repair/retry | supersession conflict, stale lease, cooldown |
| **Advisory** | Never alone | parent gate signals, seal preflight, receipt pointers |

Runtime improvements:

| Change | Effect |
|--------|--------|
| `loadSealReceiptContext` | One history scan + parallel receipt loads at seal |
| `mergeGovernanceDiagnostics` | Collapse duplicate diagnostics from overlapping gates |
| Parent signals → `warnings` not `criticalSignals` | Lanes don't treat parent gate pressure as blocking authority |
| `shouldDeferLaneGuardPostExecution` | Lane mutation tools shift-right post-guard (mirrors parent) |
| Parallel status drain + audit preflight | Seal path no longer serializes on UI coalescer |
| `resolveContinuationFromParentSignals` | Explicit fast-path when only advisory parent context exists |

---

## Second throughput hardening pass

| Module | Change |
|--------|--------|
| `IoRequestCoalescer` | Singleflight dedupe for identical parent/lane I/O reads (5s TTL) |
| `ParentIoBulkhead` | Bounded parallel parent I/O when parallel tool calling enabled |
| `laneStateMachine` | Explicit states: pending → running → partial → degraded_complete / hard_blocked |
| `SoftBlockRetryBudget` | Soft blockers retry up to 3× then emit `no_progress_execution_loop` once |
| `evaluateCoordinatorFastContinuation` | Fast-path continue when no live hard blocker |
| `TaskState.swarmRuntime` | Parent tracks in-flight swarm — I/O bulkhead prioritizes reads during swarm |
| `SubagentToolHandler` | Non-blocking running status; advisory lane timeout → `degraded_complete` |
| `SubagentStatusItem.laneRuntimeState` | Compact lane lifecycle for parent summarization |

---

## Behavioral constraints

The runtime must avoid:

- recursive self-verification
- duplicate audit gates
- authority ambiguity
- receipt-driven paralysis
- escalation loops
- infinite reconciliation
- ceremonial retries
- governance amplification

The system should prefer:

- forward progress
- bounded recovery
- transparent correction
- authoritative reconciliation

---

## Recovery philosophy

The goal of governance is not perfect caution.

The goal is:

- safe continuation
- understandable recovery
- bounded execution integrity

A governed runtime that cannot recover or proceed is **operationally failed** even if all safeguards technically succeeded. This does not permit authority substitution: database unavailability, corrupt identities, mode mismatch, and newer projection tokens remain fail-closed until the authoritative state can be read safely.

Normal reconciliation requires a database-available snapshot. It may reclaim an expired authoritative lease, remove confirmed orphan projections, or repair stale/missing projections. It must not unlink malformed records or reclaim anything while SQLite is unavailable.

Manual or panic cleanup is isolated in `AdministrativeLockCleaner.ts`. It requires an explicit override reason, logs every record it unlinks, and is not exposed through `LockAuthority` or ordinary orchestration paths.

---

## Runtime heuristic

If the runtime repeatedly references receipts, audits, retries, or verification artifacts **without producing meaningful state change**, assume governance recursion or authority confusion is occurring.

In this situation:

- collapse duplicate gates
- reduce audit recursion
- re-establish coordinator authority
- invalidate stale receipt assumptions
- restore execution momentum

> **Progress is evidence. Recursive validation without progress is failure.**

---

## Agent prompt (condensed)

When governed swarms or completion gates are active, agents should internalize:

```
GOVERNED EXECUTION AUTHORITY
- Receipts, gate snapshots, and audit traces are forensic history — not live execution authority.
- Only the parent coordinator decides merge, seal, finalization, and continuation.
- Do not halt swarm work solely because a lane receipt or stale audit suggests blockage.
- Re-check current coordinator state; prefer repair and continuation over recursive escalation.
- Progress is evidence; repeated validation without state change is failure.
```

The ACT-mode prompt exposes only the semantic state needed for the next transition:

```text
# EXECUTION STATE

Mode: ACT
Workspace: <workspacePath>
Task: <taskId>
Next required action: <nextAction>
Active hard blockers: <blockers>
Lane progress: <lanesComplete>/<lanesTotal> complete
Completion condition: <condition>
```

Raw fencing tokens, lease epochs, mistake counters, and advisory warnings are intentionally omitted. Those values remain available to the runtime and operator diagnostics, not the model decision surface. See `src/core/prompts/system-prompt/registry/PromptBuilder.ts`.

---

## Operator checklist

| Symptom | Likely confusion | Action |
|---------|------------------|--------|
| Agent stops because envelope shows old gate block | Receipt treated as live authority | Run authoritative state procedure; check seal barrier |
| Chat says failed but history has sealed success | Latest pointer stale | Load authoritative receipt from history |
| Lane warns `auditDeferredToSeal` | Expected — not a lane failure | Join audit at parent seal |
| Parent re-reads same audit with no workspace change | Governance recursion | Fix workspace; rely on cache-aside / avoid duplicate summaries |
| 10× completion blocks | Circuit breaker (intentional cold path) | `run_finalization` when engineering verified |
| Database authority unavailable | No production authority snapshot | Restore SQLite; retry or fail closed; never switch to local mode |
| Malformed or clock-skewed projection | Projection corruption | Preserve the record, inspect it, and reconcile only with SQLite available |
| Emergency cleanup required | Ordinary reconciliation cannot proceed safely | Use isolated `AdministrativeLockCleaner` with a recorded override reason |
