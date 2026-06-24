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
- DAG dependency allows ordered overlap (infrastructure present; handler wiring incomplete).
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
