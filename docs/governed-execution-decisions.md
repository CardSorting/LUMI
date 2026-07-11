# Governed Execution — Design Decisions

Architecture Decision Records (ADR-style) for the governed subagent harness. Status reflects current implementation.

Full architecture: [governed-subagent-execution.md](governed-subagent-execution.md).

---

## ADR-001: Locks protect mutation; receipts preserve truth

**Status:** Accepted

**Context:** Early anti-recursion guards blocked vague escalation prompts. The real failure mode was false-positive gate locks — read/audit lanes acquiring mutation ownership they never needed.

**Decision:**

- **Locks** gate exclusive mutation ownership only.
- **Receipts** record what happened for every lane, with or without a lock.
- Non-mutating lanes emit `lockRequired: false`, `claimId: null`, empty `lockBackends`.

**Consequences:**

- Parallel read-only lanes do not collide or orphan claims.
- Merge gate distinguishes mutation-without-lock (fail) from non-mutating-without-lock (pass).
- Operator console shows **lock skipped** — not "missing lock."

**Clarification (ADR-015):** *Receipts preserve truth* means **forensic** truth for merge/replay — not live authority to block continuation. See [governed-execution-authority.md](governed-execution-authority.md).

---

## ADR-002: Unified lock authority with layered backends

**Status:** Accepted

**Context:** Mutation ownership must survive process restarts, cross-process workers, and stale primary scenarios without split-brain writes.

**Decision:** Single `LockAuthority` interface with `UnifiedLockAuthority` stacking:

1. In-process registry (fast path, TTL)
2. Roadmap lease (admission control)
3. SwarmMutex SQLite (durable mutex)
4. File lock (`wx` exclusive create)
5. Broccoli fence (fencing token file)

Partial acquire rolls back and fails closed. Fencing token assigned before durable layers.

**Consequences:**

- Familiar lease + fencing token pattern (Kleppmann).
- `recoverStale` clears in-process, file, fence — not SwarmMutex or roadmap rows.
- `mem_release` uses in-process release only (no workspace durable release).

**Alternatives considered:**

- File lock only → insufficient for in-process collision detection.
- Separate authorities per layer → split-brain risk.

---

## ADR-003: Lock necessity classifier (intent-scoped)

**Status:** Accepted

**Context:** Not every lane mutates. Forcing locks on audit/review lanes creates collisions, stale claims, and merge false positives.

**Decision:**

- Six execution modes; default `mutation` for backward compatibility.
- `classifyLockNecessity()` runs before `acquireLane()`.
- Escalation tags (`write_set`, `mutates_roadmap`, …) promote non-mutating lanes to lock-required.
- Post-execution `splitReadWriteSets()` + write-tool detection for merge enforcement.

**Consequences:**

- Harness authors opt out via `[execution_mode:read_only]` etc.
- Documentation/audit lanes stay durable without ownership pressure.
- Non-mutating lane that runs write tools without lock → merge blocked.

---

## ADR-004: Merge gate as optimistic reconciliation

**Status:** Accepted

**Context:** Parallel lanes improve throughput; success must not be declared until writes are reconciled.

**Decision:** `runMergeGate()` is the commit barrier after execution:

- Collision detection on **write sets** only.
- DAG dependency allows ordered overlap, and the handler prioritizes the longest ready dependency path.
- Separate audits for mutation-without-lock and non-mutating-with-writes.
- Orphaned/unreleased claims count only `lockRequired` lanes.

**Consequences:**

- Industry-familiar OCC pattern: execute optimistically, reconcile before commit.
- Read overlap never blocks merge.
- Violation strings are stable operator signals (catalog in runbook).

---

## ADR-005: Receipt schema v3 and attempt lineage

**Status:** Accepted

**Context:** Retries, crashes, and partial seals must not erase prior successful work.

**Decision:**

- Immutable per-attempt file: `{swarmId}.governed.{attemptId}.json`
- Append-only `history.jsonl` index
- Latest pointer `{swarmId}.governed.json` guarded — does not regress over sealed+merged prior when retry fails
- `parentAttemptId` + `attemptId` chain
- `loadAuthoritativeGovernedReceipt()` for operator truth

**Consequences:**

- Failed retry leaves authoritative state on prior sealed attempt.
- Chat status alone is unreliable.
- Supersession guard blocks unsafe overwrite.

---

## ADR-006: Replay checksum canonicalization

**Status:** Accepted

**Context:** Detect receipt/envelope tampering or drift after seal.

**Decision:** SHA-256 over a minimal canonical JSON subset (lane status, touched files, admission, merge result, replay artifact IDs).

**Consequences:**

- Lock-necessity fields (`executionMode`, `readSet`, `writeSet`) are **not** in the hash.
- Mismatch means canonical execution state drift — use `explainReplayMismatch()` for operator text.
- Checksum is integrity of execution outcome, not full receipt blob.

**Future:** Extend canonical form if lock fields must be integrity-protected.

---

## ADR-007: worker_cli as intentional subset

**Status:** Accepted (boundary)

**Context:** BroccoliDB process workers need cross-process exclusion without full LUMI coordinator.

**Decision:** `worker_cli.ts` uses shared file lock module only:

- Resource key: `governed-lane:{swarmId}:{laneId}` (differs from LUMI index-based key)
- Receipt schema v1 at `.broccolidb/governed/receipts/{workerId}.json`
- No merge gate, lock necessity, or fencing stack integration

**Consequences:**

- Do not assume worker_cli receipts interoperate with `GovernedSwarmReceipt` v3.
- Full harness parity is a future integration task.

---

## ADR-008: Default mutation mode for backward compatibility

**Status:** Accepted

**Context:** Existing swarms and prompts assume mutating lanes acquire locks.

**Decision:** Unmarked lanes resolve to `execution_mode: mutation`.

**Consequences:**

- No behavior change for edit-heavy swarms.
- Opt-in required for lock-skipped read/audit parallelism.

---

## ADR-009: Roadmap and audit coordination on governed receipts

**Status:** Accepted (integration pass)

**Context:** Governed swarms used roadmap only for pressure admission and MergeGate as implicit audit. Operators could not answer where roadmap planning, audit preflight, or per-lane audit entered the lifecycle.

**Decision:**

- Wire `scheduleAdmission` (pressure) + `acquireOrchestrationLease` (execution ownership) before lanes.
- Record `roadmapLinkage` and `auditIntegration` on `GovernedSwarmReceipt` schema v3 (additive fields).
- `MergeGate` documented as **commit barrier only**; workspace audit remains `completionGatePipeline`.
- Lane DAG deps via `[depends_on:N]`; audit preflight via `evaluateGatePreflightReadinessAsync`.

**Consequences:**

- Receipts prove coordination without new execution architecture.
- BroccoliDB remains substrate — audit evidence stays under `subagent_executions/`.

---

## ADR-010: Roadmap completion policy and crash sealing

**Status:** Accepted (closure pass)

**Context:** Orchestration lease was not acquired; roadmap kanban could not be updated safely; handler timeout used partial `sealReceipt` instead of `sealCrashReceipt`.

**Decision:**

- Default `advisory_only` roadmap completion; optional `roadmap_completion_update=enabled` only when sealed + merge + integrity pass.
- Release orchestration lease on seal/crash; record `orchestrationLease` on receipt.
- `SubagentToolHandler` invokes `sealCrashReceipt` on timeout/abort with `inferSwarmCrashPhase`.
- `shouldUpdateLatestPointer` preserves authoritative sealed success over failed crash retries.

**Consequences:**

- No blind roadmap mutation on failed/partial/replay-mismatched receipts.
- Operators get precise crash phases and lease risk in incident console.

---

## ADR-011: Per-agent roadmap projection (coordinator-owned workspace commits)

**Status:** Accepted (projection pass)

**Context:** Parallel lanes acquiring per-lane `roadmap:*` locks serialized kanban writes but still encouraged agents to treat the shared workspace roadmap as mutable local state. Collisions, stale leases, and smuggled completion signals made operator triage difficult.

**Decision:**

- Split roadmap into three planes: `agentRoadmap` (private), `swarmRoadmap` (read-only plan), `workspaceRoadmap` (authoritative).
- `acquireLane()` creates `agentRoadmap` projection; `requiresRoadmapMutationLock()` returns `false` — no per-lane workspace roadmap locks.
- Agents record `localRoadmapEvents` and `proposedWorkspacePatch` on lane receipts.
- `runRoadmapPatchReconciliation()` at seal merges compatible patches; `commitWorkspaceRoadmapPatches()` is the **only** workspace write path.
- Coordinator acquires `roadmap:workspace` lock once at seal when committing reconciled patches.
- `auditDirectWorkspaceRoadmapMutation()` flags `directWorkspaceRoadmapMutation` and containment violations.

**Consequences:**

- Private roadmap state is cheap; workspace truth is expensive.
- Parallel lanes no longer fight over kanban locks during execution.
- Merge gate still audits legacy direct-write signals via `RoadmapMergeAudit`.
- Operator console shows projection planes, accepted/rejected patches, commit status.

**Alternatives considered:**

- Shared roadmap mutation with finer locks → rejected; still exposes parallel mutation surface.
- Chat-only roadmap updates → rejected; no durable receipt truth.

---

## ADR-012: Projection hardening (quality gate, containment, rebase)

**Status:** Accepted (hardening pass)

**Context:** Projection model alone does not prevent vague patches, smuggled mutations in local events, or stale projections overwriting current workspace state.

**Decision:**

- **Patch quality gate** (`validatePatchQuality`) — every non-advisory patch requires full metadata; `mark_complete` / `reopen_item` require evidence; vague rationale rejected.
- **Local event containment** (`containLocalRoadmapEvents`) — allowlist private event types; mutation-like payloads rejected or converted to patches.
- **Projection rebase** (`attemptPatchRebase`) — safe rebase for `attach_evidence`, `add_blocked_reason`, etc.; stale conflicting types (`mark_complete`, `move_lane`) → `stale_conflict`.
- **Deeper reconciliation** — compatible evidence merges; conflicting lane moves fail; failed lanes cannot complete; completed items require `reopen_item`; advisory patches stay advisory.
- **Coordinator commit guards** (`canCoordinatorCommitWorkspaceRoadmap`) — merge passed, integrity valid, sealed, reconciliation passed, completion policy, `roadmap:workspace` lock.
- **Operator UX** — `GovernedReceiptPanel` shows rebase outcomes, rejection reasons, stale projection warnings.

**Consequences:**

- Only valid, evidence-backed, reconciled patches affect workspace roadmap.
- Reconciliation failures append to `mergeGate.violations` and block seal.
- Regression tests in `governedExecutionRoadmapProjectionHardening.test.ts` lock behavior.

**Non-goals (explicit):**

- No return to shared per-lane workspace mutation.
- No additional lock layers for projections.
- No lane-level workspace commit path.

---

## ADR-013: Bounded, work-conserving parent flow control

**Status:** Accepted

**Context:** A fixed worker pool was necessary but insufficient. Progress events queued an unbounded number of artifact writes, deterministic failures consumed retry slots, timed-out attempts could overlap replacements, concurrent lanes shared a mutable model client, and index-order scheduling could delay the lane that unlocked the longest dependency chain.

**Decision:**

- Keep a three-request concurrency ceiling behind a priority-aware execution pool with a fast-I/O bulkhead (one reserved slot when non-mutating lanes wait). Dispatch ready lanes by weighted longest downstream critical path. Read-only and diagnostic lanes receive a dispatch boost aligned with I/O authority. Retry backoff releases its slot.
- Coalesce progress to the latest state and cap artifact/UI emission frequency. A parent I/O barrier stops progress writers before terminal sealing. Partial running progress is UI-only; durable artifacts are written at terminal staging/seal barriers.
- Serialize writes per swarm, replace artifacts atomically, and allow unrelated swarms to persist concurrently. Stage terminal state with an unsealed marker; only the parent post-reconciliation path may publish the resumable final artifact.
- Treat progress/UI telemetry as best-effort, bound UI waits, and start workers without waiting for it. Start child-stream registrations together without gating any lane.
- Run advisory audit preflight alongside workers, bound it to ten seconds, and join it at the seal barrier.
- Retry only transient infrastructure failures, at one parent layer, with capped full-jitter backoff and three total attempts.
- Acquire execution slots before lane claims; release governed locks during retry backoff so jitter does not hold lane ownership.
- Prefetch parent stream context and completion-gate options once per swarm; bound active lane executions to pool capacity plus one successor (retry backoff does not consume an active execution slot).
- Give every attempt a fresh runner, model client, prompt context, and timeout; abort and wait for quiescence before replacement.
- Give each attempt one lane-local task state and tool coordinator; completion gates never mutate parent or sibling state.
- Count tokens and cost across all attempts, and stop pending/running work when the aggregate parent budget is crossed.
- Resolve read versus mutation authority before launch: read auto-approval is valid only for non-mutating lanes and constrains their toolset to local reads/diagnostics; mutation follows edit auto-approval; mixed swarms require both. Any missing permission becomes one parent approval, with no repeated inner prompts.
- Propagate failed dependencies immediately, diagnose true deadlocks with dependency states, and release the orchestration lease in a final cleanup barrier.
- Keep peer spawning and shared-ledger synthesis at the parent; workers return structured review/documentation requests unless explicitly assigned ownership.

**Consequences:**

- Bursty token progress no longer becomes an I/O backlog.
- Delayed progress cannot overwrite a sealed artifact, and readers never observe a partial JSON write.
- Permanent task failures free a worker slot immediately; retries do not amplify deterministic faults.
- A throttled lane waiting on jitter does not reduce active capacity for untouched lanes.
- Slow trace registration never gates execution; advisory preflight and unavailable progress UI have bounded waits.
- Approval remains explicit at the authority boundary without adding per-tool latency inside an authorized lane.
- Cancellation and retry are isolated per lane, without a shared-client abort blast radius.
- Parent receipts include retry spend and cannot report budget-crossing work as successful.
- Dependency-heavy swarms reduce makespan without raising the concurrency ceiling.
- Non-mutating lanes retain reserved pool capacity and may parallelize independent read/diagnostic tool calls when the parent enables parallel tool calling.

---

## ADR-014: Parent I/O execution authority (shift-right gates)

**Status:** Accepted

**Context:** Parent main-thread throughput degraded when every read, list, or search paid full UniversalGuard pre/post execution, blocking advisory audits, per-read Spider registry rebuilds, and duplicate guard calls in validators. Subagent read lanes already had I/O bulkhead fairness (ADR-013) but parent tools did not share a single authority model.

**Decision:**

- Introduce `executionAuthority.ts` with `IO_AUTHORITY_TOOLS` and helpers for guard bypass, PreToolUse skip, session spider reuse, and deferred post-guard work.
- **Hot path:** Parent I/O tools skip full guard; sync `onReadIoAuthority()` only; approval before PreToolUse before execute on list/search handlers.
- **Warm path:** Act-mode, plan-mode, and command-output audits run fire-and-forget; post-guard GC, roadmap journal, scratchpad validation, and drift detection run after `pushToolResult`.
- **Cold path:** `attempt_completion` retains authoritative audit gate with 5-minute cache-aside, progressive critical-only threshold for first blocks, and advisory→plan baseline fallback on infra failure.
- Eliminate duplicate `guardPreExecution` in `ToolValidator.checkArchitecturalPurity` — `ToolExecutor` owns guard once.
- Subagent lanes: sync preflight only in `subagentCompletionGates`; expensive `auditTask` deferred to parent seal barrier.

**Consequences:**

- Read-heavy parent loops no longer block on guard, Spider rebuild, or PreToolUse for I/O authority tools.
- Engineering verification remains fail-closed at completion; inner-loop audits are observability, not gates.
- Operators distinguish **instant I/O** from **authoritative completion** — see [parent-thread-execution-authority.md](parent-thread-execution-authority.md).

**Non-goals (explicit):**

- No bypass of plan-mode write restrictions or disk blockade.
- No removal of `attempt_completion` audit gate.
- No parent parallel-tool I/O bulkhead on main thread (future work).

**Failure documentation:** Block reasons, preflight stages, and throughput-vs-safety distinction — [parent-thread-execution-authority.md § What blocked throughput](parent-thread-execution-authority.md#what-blocked-throughput-before-vs-after).

---

## ADR-015: Coordinator owns live authority; receipts are forensic

**Status:** Accepted

**Context:** Governed swarms produce many observational artifacts — lane receipts, gate envelopes, audit metadata, retry markers, reconciliation traces. Agents and operators sometimes treat these as **live execution authority**, causing receipt-driven paralysis, duplicate audit recursion, and escalation loops without workspace progress. ADR-001 established receipts as durable history but did not explicitly separate forensic truth from canonical **continuation** decisions.

**Decision:**

- **Forensic truth:** Receipts, history JSONL, gate snapshots, and audit entries record what happened — merge, replay, operator console, post-mortems.
- **Live authority:** Only the coordinator/runtime layer (`GovernedSwarmCoordinator`, parent `attempt_completion` cold path, `MergeGate` seal) decides whether execution may continue, merge, finalize, or invalidate **now**.
- Subagents may observe, recommend, annotate, and challenge — not freeze siblings or the parent using receipts alone.
- Before blocking on a receipt-shaped signal, re-evaluate current coordinator state; prefer repair/reconciliation/continuation over recursive escalation.
- Avoid duplicate audit gates and re-verification of identical invariants across layers (aligns with ADR-014 shift-right).

**Consequences:**

- Operators use authoritative state procedure — not chat status alone — when receipts disagree.
- Lane `auditDeferredToSeal` is expected observability, not lane failure.
- Runtime heuristic: repeated validation without state change indicates governance recursion — collapse gates and restore momentum.

**Non-goals:**

- Receipts do not become optional — they remain required for merge and seal.
- This does not remove intentional cold-path blockers (`attempt_completion` audit, circuit breaker, merge violations).

Full prompt and operator checklist: [governed-execution-authority.md](governed-execution-authority.md).

---

## ADR-016: Required merge checks, advisory audits, and bounded remediation

**Status:** Accepted

**Context:** The merge gate previously flattened transaction-safety failures and evidence-quality heuristics into one `violations[]` list. Missing evidence, placeholder text, transcript pointers, and tool steps could fail an otherwise safe completed swarm. Stale ownership events were also counted historically, so `stale_detected` remained fatal after a matching release. Parent agents interpreted every failed seal as a reason to rerun the whole swarm, amplifying cost and retry loops.

**Decision:**

- Mirror familiar required-check vs informational-check workflows: only mutation safety, live ownership, terminal lane consistency, replay integrity, and authoritative roadmap conflicts block seal.
- Preserve evidence and observability quality checks as receipt/UI advisories.
- Apply the same split to envelope persistence and resume validation: missing pointers are advisory, while malformed structure, checksum mismatch, and transcript corruption remain hard.
- Emit structured `findings[]` instead of forcing callers to parse prose.
- Emit `retryDisposition`: `not_needed`, `targeted_repair`, `retry_after_recovery`, or `do_not_retry`.
- Reconstruct current claim state from lifecycle events. A matching `released` event clears prior stale/orphan state; unresolved ownership remains fail-closed.
- Keep lane-level transient retries bounded at three attempts with full jitter. Merge remediation never implies a blind whole-swarm retry.

**Consequences:**

- Safe work seals despite incomplete secondary audit metadata.
- Hard correctness and concurrency invariants remain fail-closed.
- Recovery has explicit scope, so successful lanes and billable work are preserved.
- Historical schema-v3 receipts remain readable because new fields are optional on read.

**Industry pattern mapping:**

- Required vs non-required status checks for merge policy.
- Workflow retry policies with maximum attempts and non-retryable failure classes.
- Saga-style compensation/recovery before retrying ownership failures.
- Structured reason codes instead of control flow based on log strings.

---

## Open decisions (not yet implemented)

| Topic | State | Notes |
|-------|-------|-------|
| Replay hash includes lock/projection fields | Under discussion | ADR-006 exclusion may change |
| worker_cli key unification | Under discussion | Align resource key format with coordinator |
| BroccoliDB cross-plane audit index | Future | Thin index adapter only — receipts stay under `subagent_executions/` |
| Full patch-type commit parity | Future | `update_dependency` / `update_ownership` currently log to `decision_log` |
| Per-agent projection persistence across retries | Future | Retries re-acquire projection from current snapshot |

---

## Related

- [Architecture](governed-subagent-execution.md)
- [Quick reference](governed-roadmap-projection-quickref.md)
- [Schema reference](governed-execution-schema.md)
- [Operator runbook](governed-execution-runbook.md)
