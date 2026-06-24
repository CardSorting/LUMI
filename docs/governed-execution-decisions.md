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

## Open decisions (not yet implemented)

| Topic | State | Notes |
|-------|-------|-------|
| Replay hash includes lock fields | Under discussion | ADR-006 exclusion may change |
| worker_cli key unification | Under discussion | Align resource key format with coordinator |
| BroccoliDB cross-plane audit index | Future | Thin index adapter only — receipts stay under `subagent_executions/` |

---

## Related

- [Architecture](governed-subagent-execution.md)
- [Schema reference](governed-execution-schema.md)
- [Operator runbook](governed-execution-runbook.md)
