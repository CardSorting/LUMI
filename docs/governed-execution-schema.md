# Governed Execution Receipt Schema

Reference for `GovernedSwarmReceipt` and related types. Schema version: **`GOVERNED_RECEIPT_SCHEMA_VERSION = 3`**.

Source: `src/shared/subagent/governedExecution.ts`.

Architecture context: [governed-subagent-execution.md](governed-subagent-execution.md).

---

## Artifact layout

All paths relative to task directory `{taskDir}/subagent_executions/`:

| File | Mutability | Purpose |
|------|------------|---------|
| `{swarmId}.json` | Per-run | Swarm execution envelope |
| `{swarmId}/agents/{agentId}.transcript.jsonl` | Append-only | Lane event log |
| `{swarmId}.governed.{attemptId}.json` | **Immutable** | Per-attempt governed receipt |
| `{swarmId}.governed.history.jsonl` | Append-only | Attempt index (`attemptId`, `sealed`, `mergePassed`, …) |
| `{swarmId}.governed.json` | Updated with guard | Latest pointer — see [pointer semantics](#latest-pointer-semantics) |

Cross-process lock files (workspace root):

```
.broccolidb/governed/locks/{sha256(resourceKey)}.lock
.broccolidb/governed/fencing/{sha256(resourceKey)}.json
```

---

## GovernedSwarmReceipt

Top-level durable record written by `persistGovernedReceipt()`.

| Field | Type | Required | Semantics |
|-------|------|----------|-----------|
| `schemaVersion` | `3` | yes | Must match `GOVERNED_RECEIPT_SCHEMA_VERSION` |
| `swarmId` | string | yes | Swarm identifier |
| `executionId` | string | yes | Execution envelope ID |
| `taskId` | string | yes | Parent task ID |
| `attemptId` | string | yes | UUID for this attempt |
| `parentAttemptId` | string | no | Prior attempt when retrying |
| `admission` | `GovernedAdmissionResult` | yes | Swarm admit outcome |
| `laneReceipts` | `LaneExecutionReceipt[]` | yes | Per-lane evidence |
| `laneDag` | `LaneDAGNode[]` | yes | DAG snapshot at seal |
| `claimHistory` | `ClaimHistoryEntry[]` | yes | Mutation claim events only |
| `mergeGate` | `MergeGateResult` | yes | Gate outcome + audit |
| `replayArtifactPath` | string | yes | Path to swarm envelope |
| `governedArtifactPath` | string | yes | Path to this receipt |
| `replayChecksum` | string | no | SHA-256 canonical hash |
| `sealedAt` | number | yes | Seal timestamp (ms) |
| `sealed` | boolean | yes | `true` only if merge + replay pass |
| `retryReason` | string | no | Crash/retry annotation |
| `integrity` | `ExecutionReplayIntegrityReport` | yes | Replay validation result |
| `roadmapLinkage` | `GovernedRoadmapLinkage` | no | Roadmap pressure, per-lane items, completion advisory |
| `auditIntegration` | `GovernedAuditIntegration` | no | Preflight, per-lane completion audit, merge gate role, storage boundary |

### Latest pointer semantics

`shouldUpdateLatestPointer()` in `GovernedExecutionStore`:

- If existing latest is **sealed + merge passed** and incoming is **not sealed** → pointer **not** updated.
- Otherwise → pointer updated.

Use `loadAuthoritativeGovernedReceipt()` or walk `history.jsonl` reverse for truth after failed retry.

---

## LaneExecutionReceipt

| Field | Type | Mutation lane | Non-mutating lane |
|-------|------|---------------|-------------------|
| `laneId` | string | `swarm-lane:{swarmId}:{index}` | same |
| `agentId` | string | agent ID | same |
| `index` | number | 0-based | same |
| `status` | enum | see below | same |
| `executionMode` | `LaneExecutionMode` | `mutation` | `read_only`, etc. |
| `lockRequired` | boolean | `true` | `false` |
| `reasonLockAcquired` | string | classifier reason | — |
| `reasonLockSkipped` | string | — | classifier reason |
| `claimId` | string | UUID | omitted / null |
| `claimReleased` | boolean | tracks release | always `true` |
| `fencingToken` | number | token | omitted |
| `lockBackends` | `LockBackends` | backend map | `{}` or omitted |
| `readSet` | string[] | optional | paths read |
| `writeSet` | string[] | paths written | empty unless escalated |
| `touchedFiles` | string[] | raw envelope paths | same |
| `evidenceCount` | number | evidence refs count | same |
| `toolStepCount` | number | tool steps | same |
| `transcriptArtifactPath` | string | required for completed | same |
| `placeholderWarnings` | string[] | TODO/FIXME agents | optional |
| `auditResult` | `"passed"` \| `"failed"` | lane audit | same |
| `dagState` | `LaneDAGState` | DAG node state | optional |
| `acquiredAt` / `releasedAt` | number | from lock claim | omitted |
| `error` | string | failure message | optional |

### Lane status values

`completed` | `failed` | `skipped` | `collision_rejected` | `blocked` | `running`

### Lane execution modes

`read_only` | `audit_only` | `planning_only` | `documentation_only` | `diagnostic_only` | `mutation`

---

## WorkLaneClaim (in-flight)

Not persisted in receipt directly; drives lane receipt fields.

| Field | lockRequired=true | lockRequired=false |
|-------|-------------------|---------------------|
| `laneId` | present | present |
| `roadmapLeaseTaskId` | `swarm-lane-{swarmId}-{index}` | same |
| `lockClaim` | `LockClaim` | absent |
| `lockSkipped` | — | `true` |
| `executionMode` | from intent | from intent |
| `readSet` / `writeSet` | declared paths | declared paths |
| `roadmapLeaseTaskId` | `swarm-lane-{swarmId}-{index}` | same |
| `roadmapItemId` | from `[roadmap_item:…]` | same |
| `completionAuditPhase` | envelope phase at seal (e.g. `completion_gate`) | same |

---

## GovernedRoadmapLinkage

Recorded at seal via `captureRoadmapLinkage()`.

| Field | Semantics |
|-------|-----------|
| `roadmapEnabled` | Whether roadmap service was active at admit |
| `pressureScore` | From `scheduleAdmission` |
| `laneRoadmapItems[]` | Per-lane `roadmapItemId` + `roadmapLeaseTaskId` |
| `completionAdvisory` | Dry-run `evaluateRoadmapCompletionBlock` message |
| `incompleteIntegration[]` | Honest list of gaps (e.g. orchestration lease not acquired) |

---

## GovernedAuditIntegration

Recorded at seal via `buildGovernedAuditIntegration()`.

| Field | Semantics |
|-------|-----------|
| `preflightIssues[]` | From `evaluateGatePreflightReadinessAsync` before lanes run |
| `perLaneCompletionAudit[]` | Agent `phase` / blocked at seal |
| `mergeGateRole` | Always `"commit_barrier"` — not workspace audit |
| `workspaceAuditAtPreflight` | No blocking preflight issues |
| `workspaceAuditAtSeal` | Receipt integrity + merge passed |
| `falsePositiveLockAudit` | Lock-skipped count vs missing-lock violations |
| `storageBoundary` | Documents task artifacts vs BroccoliDB CAS |
| `roadmapCompletionAdvisory` | Copy of roadmap linkage advisory |

---

## LockClaim

| Field | Semantics |
|-------|-----------|
| `claimId` | UUID |
| `resourceKey` | e.g. `governed-lane:{swarmId}:{index}` |
| `ownerId` | agent ID |
| `fencingToken` | Monotonic (Unified) or per-claim (InMemory) |
| `roadmapLeaseTaskId` | Per-lane roadmap lease |
| `acquiredAt` | ms timestamp |
| `releasedAt` | set on release |
| `backends` | `LockBackends` participation |

### LockBackends

| Key | Layer |
|-----|-------|
| `inProcess` | In-process registry |
| `swarmMutex` | SQLite SwarmMutex |
| `roadmapLease` | Roadmap admission |
| `fileLock` | Cross-process file lock |
| `broccoliFence` | Fencing token file |

---

## ClaimHistoryEntry

Mutation lanes only. Lock-skipped lanes produce **no entries**.

| Field | Semantics |
|-------|-----------|
| `event` | `acquired` \| `released` \| `rejected` \| `stale_detected` \| `recovered` |
| `claimId` | UUID |
| `laneId` | lane identifier |
| `resourceKey` | governed resource |
| `ownerId` | agent ID |
| `fencingToken` | token at event time |
| `lockBackends` | backends at event time |
| `timestamp` | ms |
| `expiresAt` | optional TTL |
| `error` | on rejected/stale |

---

## MergeGateResult

| Field | Semantics |
|-------|-----------|
| `passed` | `violations.length === 0` |
| `violations` | Human-readable failure strings |
| `mergeAudit` | `MergeSafetyAudit` — overlaps, missing evidence, placeholders |
| `replayIntegrity` | Replay artifact validation |
| `failedLaneCount` | Count of failed lanes |
| `orphanedClaimCount` | Lock-required orphans only |
| `staleLeaseCount` | Excludes lock-skipped lanes |
| `splitBrainDetected` | Multiple owners per resource |
| `sealedSupersessionBlocked` | Unsafe retry over sealed receipt |

---

## GovernedReceiptSummary (UI / live)

Aggregated view in `GovernedReceiptPanel`. Not a separate on-disk schema.

| Field group | Contents |
|-------------|----------|
| Counts | `laneCount`, `lanesSealed`, `lanesRunning`, `orphanedClaims`, … |
| `laneStates[]` | Per-lane: status, `executionMode`, `lockRequired`, reasons, read/write sets |
| `laneDag[]` | DAG nodes with state |
| `claimTimeline[]` | Operator-friendly claim events |
| `resourceOwners[]` | Active/released/stale ownership |
| `retryHistory[]` | Attempt lineage |
| `diagnostics` | `incident`, `retrySafe`, overlap lists, replay causes |
| `violations` | Merge gate violations |

---

## Replay checksum canonical form

Computed by `validateDeterministicReplay()`:

```json
{
  "swarmId": "...",
  "executionId": "...",
  "taskId": "...",
  "admission": { },
  "laneReceipts": [
    {
      "laneId": "...",
      "agentId": "...",
      "index": 0,
      "status": "completed",
      "evidenceCount": 1,
      "touchedFiles": ["sorted", "paths"]
    }
  ],
  "mergePassed": true,
  "replayArtifactId": "...",
  "replayStatus": "completed"
}
```

SHA-256 hex digest. Stored in `replayChecksum`.

**Excluded from hash:** `claimHistory`, lock fields, `executionMode`, `readSet`, `writeSet`, fencing tokens.

---

## Validation

`validateGovernedReceipt(raw)` checks:

- `schemaVersion === 3`
- `swarmId`, `taskId`, `attemptId` present
- `laneReceipts` is array
- `mergeGate.passed` is boolean

Corrupted receipts → incident `corrupted_receipt`; refuse persist.

---

## Related

- [Architecture](governed-subagent-execution.md)
- [Operator runbook](governed-execution-runbook.md)
- [Design decisions](governed-execution-decisions.md)
