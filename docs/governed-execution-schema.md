# Governed Execution Schema and Confidence-Preserving Convergence

The harness can now finish vague, exploratory, and genuinely inconclusive work without pretending that the uncertainty disappeared. It preserves what each lane knows, what it only suspects, and why. It retries only when another narrowly scoped check could change a consequential decision.

## 1. The problem before this change

The old convergence behavior treated weak confidence as evidence that a lane had not completed successfully. That was usually tolerable for a precise implementation task, but it failed badly for research and exploration.

A vague objective naturally produces tentative answers. Different lanes may choose different reasonable scopes, make different assumptions, or conclude that the available material does not support a definitive answer. Those are useful results, not execution failures.

The merge gate could not express that distinction. When a lane returned a weak or unknown conclusion, the gate interpreted the result as failed validation and sent the lane back through retry or repair. The retry inherited the same vague objective, so it often produced the same evidence under slightly different wording. Other lanes could drift toward different interpretations in the meantime. The apparent disagreement increased, confidence fell further, and the swarm stopped making progress.

```text
vague task
    ↓
tentative or conflicting findings
    ↓
low confidence interpreted as failed validation
    ↓
lane or swarm retry
    ↓
same evidence, new wording, wider interpretation drift
    ↓
more disagreement and lower confidence
    ↓
merge loop
```

The gate could not converge because its only safe-looking choices were to accept a conclusion as though it were settled or reject the work as though the lane had malfunctioned. It had no terminal state for “the work ran correctly, but the answer remains uncertain.”

## 2. The root cause

The execution model was missing independent representations for two different questions:

1. Did the lane execute correctly and under valid governance?
2. How strongly does the resulting evidence support each claim?

Those questions had been collapsed into one success-or-failure signal. The model also lacked finding-level confidence reasons, decision criticality, explicit assumptions, task ambiguity, classified contradictions, probe history, and meaningful evidence deltas.

As a result, several conditions looked identical to the merge gate:

- a malformed or unauthorized execution;
- a valid lane with incomplete evidence;
- a valid lane answering a different interpretation of an ambiguous request;
- a tentative hypothesis;
- an advisory observation;
- an honest “unknown” result.

Once these states were indistinguishable, advisory findings could accidentally influence blocking decisions, uncertainty could trigger structural retry behavior, and an invalid execution could appear equivalent to a merely cautious answer. Repeating a claim also looked like progress because the model did not know whether the retry had produced any semantically new evidence.

Resume amplified the problem. Without a durable uncertainty record, reused findings could be remapped as generic successful results, losing the original confidence reason and exhausted-verification state. The resumed swarm could then probe the same unresolved question again.

## 3. The conceptual model now

The new model treats execution trust and knowledge strength as separate dimensions. A lane can be completely valid while its answer remains low-confidence or unknown.

| Concept | Meaning | Effect on convergence |
|---------|---------|-----------------------|
| Execution validity | Whether the lane produced a structurally sound result under valid authority, locks, receipts, checksums, provenance, and output contracts. | Invalid execution is rejected or repaired. Valid execution remains usable regardless of confidence. |
| Finding validity | Whether an individual claim is eligible for parent synthesis because it came from a valid execution and retains its provenance. | A valid finding may be accepted as supported or retained as tentative. A finding from invalid execution is rejected. |
| Confidence | How strongly the source model believes the evidence supports one finding. It belongs to that finding, not the lane or swarm as a whole. | Low or unknown confidence creates bounded uncertainty; it does not retroactively invalidate execution. |
| Advisory observation | A non-authoritative note that may be useful but is not required for a consequential decision. | It stays visible and never requires a retry by itself. |
| Contradiction | A recorded relationship between findings that differ by scope, assumption, timeframe, evidence, claim, or mutation intent. | Analytical disagreement is preserved. Only unresolved mutation or unavoidable safety conflicts hard-block. |
| Assumption | An explicit condition under which a finding is intended to hold. | The parent can select a working conclusion without erasing plausible alternatives. |
| Uncertainty | A bounded description of what is unknown, why, which claims are affected, whether proceeding is safe, and what evidence would resolve the gap. | It is a successful terminal state when no hard invariant is violated. |

This produces three useful finding groups:

- **Accepted findings** have valid provenance and high or medium confidence.
- **Tentative findings** have valid provenance and low or unknown confidence. They remain visible with their original reasons and evidence.
- **Rejected findings** came from structurally invalid execution. Confidence cannot rescue them.

There is deliberately no swarm-wide average confidence. Three well-supported facts and two hypotheses remain three supported facts and two hypotheses.

## 4. How convergence behaves now

The old behavior had no bounded-uncertainty terminal state:

```text
vague task
    ↓
uncertainty
    ↓
retry
    ↓
merge loop
```

The new behavior keeps uncertainty attached to the finding and spends verification effort only where it can affect a consequential decision:

```text
vague task
    ↓
tentative finding
    ↓
bounded verification (only if decision-critical)
    ↓
new evidence ───────────────→ re-evaluate the specific claim
    │
    └─ no meaningful evidence delta
                 ↓
         confidence plateau
                 ↓
      converge with uncertainty
```

The complete decision flow is:

```text
validate receipts, envelopes, provenance, checksums, authority, and locks
    │
    ├─ hard integrity, authority, mutation, or safety failure
    │      → hard block
    │
    ├─ one structurally invalid lane, with usable valid lanes remaining
    │      → repair or restart only that invalid lane
    │
    └─ structurally valid evidence exists
           ↓
       preserve every finding's confidence, reason, assumptions, and evidence
           ↓
       classify ambiguity and contradictions
           ↓
       evaluate uncertainty in proportion to decision criticality
           │
           ├─ advisory uncertainty
           │      → retain as tentative; no probe and no retry
           │
           ├─ important uncertainty
           │      → retain explicitly and converge; do not retry merely for a stronger score
           │
           └─ critical uncertainty
                  → run at most one claim-specific, read-only evidence probe
                         │
                         ├─ meaningful evidence delta
                         │      → re-evaluate that claim without changing source confidence
                         │
                         └─ no meaningful evidence delta or budget exhausted
                                → mark a confidence plateau
                                → converge with explicit uncertainty when safe
                                → omit unsafe mutation or hard-block only if every action is unsafe
```

In pseudocode:

```ts
if (hardGovernanceOrIntegrityFailure) return hardBlock
if (everyLaneIsStructurallyInvalid) return hardBlock
if (oneLaneIsStructurallyInvalid) return restartOnlyThatLane

preserveFindingsAndProvenance()
classifyAmbiguityAssumptionsAndContradictions()

if (criticalClaimIsUnverified && probeBudgetRemains) {
  return probeOneSpecificClaim
}

if (probeProducedNoSemanticEvidenceDelta) {
  markConfidencePlateau()
}

if (unsafeMutationHasNoSafeInterpretation) return hardBlock
if (uncertaintyRemains) return convergeWithUncertainty
return converge
```

Convergence therefore requires valid governance and some usable result, not universal confidence or artificial consensus. A critical unknown is acceptable when the parent can state what is known, why the gap remains, which assumption it used, whether acting is safe, and what evidence would settle the question.

## 5. Invariants

The following rules define the safety boundary:

- Low or unknown confidence never invalidates an otherwise valid execution.
- Structural success never raises a finding's confidence.
- Confidence belongs to findings and is never averaged into a swarm score.
- Advisory observations remain visible but cannot become authoritative facts automatically.
- Repetition, reuse, summarization, or inherited assumptions cannot increase confidence.
- Confidence may improve only through materially new evidence or a resolved contradiction.
- Evidence identity is semantic. Regenerated receipt or evidence IDs do not make a reread count as new evidence.
- A probe addresses one claim, is read-only, does not restart successful lanes, and cannot recursively create more probes.
- Probe budgets are strict: one probe per critical claim and two confidence probes per swarm.
- A confidence plateau is a valid terminal state for exploratory work.
- Analytical contradictions preserve both sides and their assumptions; they do not imply execution failure.
- Uncertain mutations never bypass authority, lock, receipt, or safety rules.
- Invalid or corrupted receipts, checksum failures, invalid provenance, unresolved mutation conflicts, and unsafe operations remain fail-closed.
- Resume preserves source confidence, confidence reason, assumptions, evidence, authority, contradictions, and exhausted probes.
- Reused tentative evidence remains tentative.
- “Converged with uncertainty” is successful execution health, not a degraded or failed swarm.

## 6. What a harness user notices

The practical change is that exploratory work now ends with an honest result instead of an orchestration failure.

- Vague research tasks complete even when no definitive answer exists.
- A weak lane no longer vetoes stronger valid lanes.
- “Unknown” is reported as an insufficient-evidence conclusion rather than a failed execution.
- Contradictory interpretations appear as alternatives with their scopes and assumptions instead of triggering endless retries.
- Advisory audit findings remain visible while the receipt still seals.
- A consequential evidence gap launches one focused verification request instead of replaying the original assignment across the swarm.
- Repeated verification over the same evidence stops at a confidence plateau.
- Resume does not re-probe exhausted claims or silently turn tentative findings into facts.
- Parent synthesis can say, “Under assumption A, B is the strongest current conclusion; C remains unspecified, and D is still plausible.”
- Operators can distinguish invalid execution, low confidence, task ambiguity, unverified critical claims, plateaus, bounded-uncertainty completion, and true hard blocks in diagnostics.

## 7. How the implementation provides this behavior

The implementation extends the existing convergence path rather than adding a second generic gate:

- `SubagentEnvelopeBuilder` creates result envelopes with independent `executionValidity` and finding-level confidence metadata. It preserves confidence reasons, assumptions, criticality, evidence, and explicit uncertainty language in `src/core/task/tools/subagent/SubagentEnvelopeBuilder.ts`.
- `ConfidenceAwareConvergence` is the canonical decision evaluator. It groups findings, detects ambiguity, classifies contradictions, enforces probe budgets, compares semantic evidence, detects plateaus, and returns the structured convergence package in `src/core/task/tools/subagent/ConfidenceAwareConvergence.ts`.
- `MergeGate` invokes that evaluator after the existing authority, mutation, receipt, and replay checks. Bounded uncertainty becomes advisory; existing hard safety violations remain blocking in `src/core/task/tools/subagent/MergeGate.ts`.
- `UseSubagentsToolHandler` executes only the requested bounded, read-only probe and feeds its evidence delta back into the same evaluator in `src/core/task/tools/handlers/SubagentToolHandler.ts`.
- `GovernedSwarmCoordinator` and `GovernedExecutionStore` seal and validate the decision package alongside the receipt in `src/core/task/tools/subagent/GovernedSwarmCoordinator.ts` and `src/core/task/tools/subagent/GovernedExecutionStore.ts`.
- `ResumeSwarmFromArtifact` carries forward source authority, original confidence, and exhausted probe history in `src/core/task/tools/subagent/ResumeSwarmFromArtifact.ts`.
- `CoordinatorExecutionAuthority` reduces the structured decision into the parent continuation action, while `SwarmReportBuilder` renders accepted findings, tentative findings, assumptions, alternatives, safety, and resolution evidence in the parent result.
- Shared durable types live in `src/shared/subagent/executionEnvelope.ts` and `src/shared/subagent/governedExecution.ts`.
- Focused regression coverage is in `src/core/task/tools/subagent/__tests__/confidenceAwareConvergence.test.ts`, with runtime probe and resume coverage in the neighboring handler and execution-harness tests.

The persisted representation is an additive schema-v3 extension. Historical receipts remain readable; new receipts include the confidence-aware package described below.

Architecture context: [governed-subagent-execution.md](governed-subagent-execution.md) · Patch quick reference: [governed-roadmap-projection-quickref.md](governed-roadmap-projection-quickref.md).

---

## Receipt schema reference

The durable record uses `GOVERNED_RECEIPT_SCHEMA_VERSION = 3`. Roadmap projection and confidence-aware convergence fields are additive v3 fields, so this change does not require a schema-version bump.

### Artifact layout

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

Authoritative production coordination is stored in SQLite, not in those files:

- `swarm_lock_generations` — highest allocated lease epoch and fencing token per resource.
- `swarm_locks` — current authoritative lease identity and expiry.
- `task_completions` — one durable terminal result per task.

File locks and Broccoli fences are projections of the corresponding SQLite lease.

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
| `continuationDecision` | `GovernedContinuationDecision` | no | Final parent action reduced once from sealed normalized state |
| `executionPathMetrics` | `GovernedExecutionPathMetrics` | no | Critical-path validation, reconstruction, read, write, retry, and lock counters |
| `confidenceAwareConvergence` | `ConfidenceAwareConvergenceResult` | no | Additive v3 finding-level confidence, ambiguity, contradiction, probe, plateau, and parent-decision package; absent only on historical receipts |

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
| `executionValidity` | `valid` \| `invalid` | structural lane outcome | same |
| `findingConfidence` | `high` \| `medium` \| `low` \| `unknown` | principal finding confidence; never changes execution validity | same |
| `confidenceReason` | `FindingConfidenceReason` | provenance for the principal confidence value | same |
| `executionMode` | `LaneExecutionMode` | `mutation` | `read_only`, etc. |
| `lockRequired` | boolean | `true` | `false` |
| `reasonLockAcquired` | string | classifier reason | — |
| `reasonLockSkipped` | string | — | classifier reason |
| `claimId` | string | UUID | omitted / null |
| `claimReleased` | boolean | tracks release | always `true` |
| `fencingToken` | decimal string | token copied from the authoritative SQLite lease | omitted |
| `lockBackends` | `LockBackends` | backend map | `{}` or omitted |
| `readSet` | string[] | optional | paths read |
| `writeSet` | string[] | paths written | empty unless escalated |
| `touchedFiles` | string[] | raw envelope paths | same |
| `evidenceCount` | number | evidence refs count | same |
| `toolStepCount` | number | tool steps | same |
| `transcriptArtifactPath` | string | recommended for completed; missing pointer is advisory | same |
| `placeholderWarnings` | string[] | TODO/FIXME agents | optional |
| `auditResult` | `"passed"` \| `"failed"` | lane audit | same |
| `dagState` | `LaneDAGState` | DAG node state | optional |
| `acquiredAt` / `releasedAt` | number | from lock claim | omitted |
| `error` | string | failure message | optional |
| `roadmapReadSet` / `roadmapWriteSet` | string[] | optional | Declared roadmap scope (audit) |
| `roadmapMutationLockRequired` | boolean | optional | Legacy audit flag; always `false` under projection model |
| `agentRoadmapId` | string | optional | Per-lane projection ID |
| `roadmapSnapshotId` | string | optional | Workspace snapshot at projection creation |
| `projectedItems` | string[] | optional | Items in agent projection |
| `localRoadmapEvents` | `LocalRoadmapEvent[]` | optional | Private agent-plane events |
| `proposedWorkspacePatch` | `ProposedWorkspacePatch[]` | optional | Workspace change proposals |
| `directWorkspaceRoadmapMutation` | boolean | optional | Direct workspace write attempted |
| `localEventContainmentViolations` | string[] | optional | Smuggled local event violations |
| `sourceAuthority` | object | optional | Original swarm, attempt, lane, and agent authority retained when a sealed lane is reused |

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
| `agentRoadmap` | `AgentRoadmapProjection` | present when roadmap enabled |
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
| `orchestrationLease` | Swarm-level `acquireOrchestrationLease` status (`acquired`, `released`, `unreleasedRisk`) |
| `completionPolicy` | `advisory_only` (default) or `update_on_sealed_success` |
| `completionOutcome` | `advisory_only` \| `blocked` \| `updated` with reason |
| `incompleteIntegration[]` | Honest list of remaining gaps |
| `workspaceRoadmapSnapshotId` | Current workspace snapshot at seal (`rm-snap-…`) |
| `swarmRoadmapPlan` | Swarm-scoped plan linkage (`SwarmRoadmapPlan`) |
| `agentProjections` | Summary of per-lane projections |
| `patchReconciliation` | `RoadmapPatchReconciliation` — accepted/rejected patches, rebase |
| `workspaceCommit` | `RoadmapWorkspaceCommitResult` — coordinator commit outcome |

---

## Roadmap projection types

Source: `src/shared/subagent/roadmapProjection.ts`.

### LocalRoadmapEvent

| Field | Type | Semantics |
|-------|------|-----------|
| `type` | `LocalRoadmapEventType` | `todo_state`, `progress_note`, `dependency_observation`, `completion_confidence`, `evidence_checklist`, `blocked_reason` |
| `itemId` | string | optional | Target item |
| `payload` | string | optional | Event detail |
| `timestamp` | number | ms |
| `containment` | `accepted` \| `rejected` \| `converted_to_patch` | Containment outcome |
| `rejectionReason` | string | optional | Why rejected or converted |

### ProposedWorkspacePatch

| Field | Type | Required | Semantics |
|-------|------|----------|-----------|
| `patchId` | string | yes | Stable patch identifier |
| `agentRoadmapId` | string | yes | Owning projection |
| `laneId` | string | yes | Source lane |
| `agentId` | string | yes | Source agent |
| `type` | `WorkspacePatchType` | yes | Patch operation |
| `itemId` | string | yes | Target roadmap item |
| `advisory` | boolean | no | Advisory-only (not committed) |
| `baseWorkspaceSnapshotId` | string | yes | Snapshot patch built against |
| `baseSnapshotId` | string | deprecated | Use `baseWorkspaceSnapshotId` |
| `evidencePointer` | string | for completion | Evidence path or ref |
| `confidence` | number | non-advisory | ≥ 0.5 required |
| `rationale` | string | non-advisory | Min 8 chars; vague rejected |
| `expectedTransition` | `{ from?, to }` | yes | Expected state change |
| `conflictPolicy` | `PatchConflictPolicy` | yes | Rebase / conflict behavior |
| `payload` | object | no | Type-specific metadata |

**WorkspacePatchType:** `mark_complete`, `move_lane`, `update_dependency`, `add_blocked_reason`, `attach_evidence`, `update_ownership`, `suggest_follow_up`, `advisory_only`, `reopen_item`.

**PatchConflictPolicy:** `fail_on_conflict`, `rebase_if_safe`, `require_explicit_reopen`.

### AgentRoadmapProjection

| Field | Semantics |
|-------|-----------|
| `agentRoadmapId` | `agent-rm:{swarmId}:{index}` |
| `roadmapSnapshotId` | Workspace snapshot at creation |
| `swarmRoadmapId` | Parent swarm plan ID |
| `laneId`, `agentId`, `index` | Lane identity |
| `plane` | Always `"agent"` |
| `projectedItems` | Item IDs lane believes it owns |
| `roadmapItemId` | Primary linked item |
| `dependsOn` | Upstream lane indices |
| `executionMode` | Lane execution mode |
| `goalSummary` | optional | Lane goal text |

### SwarmRoadmapPlan

| Field | Semantics |
|-------|-----------|
| `swarmRoadmapId` | `swarm-rm:{swarmId}` |
| `roadmapSnapshotId` | Snapshot at swarm admit |
| `swarmId` | Swarm identifier |
| `laneItemIds` | Per-lane `{ index, laneId, roadmapItemId? }` |

### RoadmapPatchReconciliation

| Field | Semantics |
|-------|-----------|
| `passed` | No violations and no rejected non-advisory patches |
| `violations` | Conflict strings (e.g. incompatible parallel patches) |
| `acceptedPatches` | Patches that passed quality + rebase + conflict checks |
| `rejectedPatches` | `{ patch, reason }` pairs |
| `staleProjections` | `agentRoadmapId` values out of sync |
| `rebaseResults` | Per-patch rebase outcome |
| `commitStatus` | `pending` \| `committed` \| `blocked` \| `advisory_only` \| `skipped` |
| `workspaceSnapshotId` | Snapshot at admit |
| `currentWorkspaceSnapshotId` | Snapshot at seal |

### PatchRebaseResult

| Field | Semantics |
|-------|-----------|
| `patchId` | Patch identifier |
| `agentRoadmapId` | optional | Source projection |
| `outcome` | `not_needed` \| `rebased` \| `stale_conflict` \| `rejected` |
| `fromSnapshotId` | Base snapshot |
| `toSnapshotId` | optional | Rebased target |
| `reason` | optional | Human-readable explanation |

### RoadmapWorkspaceCommitResult

| Field | Semantics |
|-------|-----------|
| `committed` | Whether workspace state was written |
| `commitStatus` | Final commit status |
| `workspaceLockAcquired` | Whether `roadmap:workspace` lock held |
| `appliedPatchIds` | Patches applied to runtime state |
| `error` | optional | Commit error message |
| `blockReason` | optional | Why commit blocked or skipped |

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
| `workspaceRoadmapSnapshotId` | Current workspace snapshot |
| `staleProjectionWarnings` | Stale `agentRoadmapId` list from reconciliation |
| `rebaseResults` | Per-patch rebase outcomes |
| `rejectedPatchReasons` | `{patchId}: {reason}` strings |
| `roadmapCommitStatus` | Workspace commit status |

---

## LockClaim

| Field | Semantics |
|-------|-----------|
| `claimId` | UUID |
| `resourceKey` | e.g. `governed-lane:{swarmId}:{index}` |
| `ownerId` | agent ID |
| `leaseEpoch` | Required decimal string; exact authoritative lease generation |
| `fencingToken` | Required monotonic decimal string; never parse through JavaScript `number` |
| `authorityMode` | Required `sqlite` or `local_test`; incompatible records are rejected |
| `roadmapLeaseTaskId` | Per-lane roadmap lease |
| `acquiredAt` | ms timestamp |
| `releasedAt` | set on release |
| `backends` | `LockBackends` participation |

Production identity is the complete tuple:

```text
resourceKey + ownerId + leaseEpoch + fencingToken + authorityMode
```

Release and projection cleanup must compare the full tuple. Matching only the owner or resource is insufficient because an old process may share those values with a newer lease generation.

### LockBackends

| Key | Layer |
|-----|-------|
| `inProcess` | In-process registry |
| `swarmMutex` | SQLite SwarmMutex |
| `roadmapLease` | Roadmap admission |
| `fileLock` | Cross-process file lock |
| `broccoliFence` | Fencing token file |

### SQLite coordination rows

`swarm_lock_generations` preserves monotonic counters even after the active lease row is removed:

| Field | Type | Semantics |
|-------|------|-----------|
| `resourceKey` | `TEXT` | Primary key |
| `highestLeaseEpoch` | `TEXT` | Highest allocated arbitrary-precision epoch |
| `highestFencingToken` | `TEXT` | Highest allocated arbitrary-precision token |

`swarm_locks` contains the current lease:

| Field | Type | Semantics |
|-------|------|-----------|
| `resource` | `TEXT` | Primary key |
| `ownerId` | `TEXT` | Current owner |
| `expiresAt` / `createdAt` | integer timestamp | Lease time bounds |
| `leaseEpoch` | `TEXT` | Current generation |
| `fencingToken` | `TEXT` | Current fencing token |
| `protocolVersion` | integer | Must equal `SWARM_LOCK_PROTOCOL_VERSION` |
| `authorityMode` | `TEXT` | Must be `sqlite` in production |
| `pid` | integer | Diagnostic process identity; never sufficient for ownership |

Generation allocation and lease upsert occur under one `BEGIN IMMEDIATE` transaction. Production release uses a compare-and-delete on resource, owner, epoch, token, and mode.

### Filesystem projection record

Governed lock and Broccoli projection records carry the same owner, epoch, token, mode, timestamps, and PID as the authoritative lease. A projection is corrupt when required identity fields are missing or malformed, its mode is incompatible, or `expiresAt < claimedAt`.

For a valid file record, expiry is evaluated as:

```ts
const referenceTime = record.heartbeatAt ?? record.claimedAt
const isExpired = record.expiresAt !== undefined
  ? now > record.expiresAt
  : now > referenceTime + staleMs
```

Corrupt records are reported and preserved. They are not automatically unlinked.

## Durable task completion

`task_completions` is the authoritative terminal-result table:

| Field | Type | Semantics |
|-------|------|-----------|
| `taskId` | `TEXT` | Primary key; one terminal row per task |
| `decisionId` | `TEXT` | Unique canonical SHA-256 digest |
| `status` | enum text | `succeeded`, `failed`, or `cancelled` |
| `evaluatedStateVersion` | integer | Task state version evaluated by the decision |
| `evaluatedCheckpointJson` | `TEXT` | Canonical checkpoint identity payload |
| `decisionJson` | `TEXT` | Persisted terminal decision payload |
| `ownerId` | `TEXT` | Lease owner that committed terminalization |
| `leaseEpoch` | `TEXT` | Lease generation validated during CAS |
| `fencingToken` | `TEXT` | Precision-safe fencing token validated during CAS |
| `committedAt` | integer timestamp | Commit time |

`decisionId` hashes canonical recursively sorted JSON with these explicit identity fields:

```ts
interface CompletionDecisionIdentityInput {
  taskId: string
  evaluatedStateVersion: number
  checkpoint: string
  outcome: string
  decisionSchemaVersion: number
}
```

The `BEGIN IMMEDIATE` terminal transaction validates the live lease tuple, protocol, expiry, freshest allocated generation, unchanged task state version, and any existing completion before insert. Existing-row semantics are:

| Existing row vs proposal | Result |
|--------------------------|--------|
| Same decision ID and same payload | Idempotent cached result |
| Different decision ID, same status | Existing result; duplicate suppressed |
| Different status | Terminal conflict; fail closed |
| Same decision ID, different payload | Corruption/collision; fail closed |

## Scheduler wait-for snapshot

Deadlock analysis consumes an immutable scheduler snapshot and typed edges:

```ts
type WaitEdge =
  | { kind: "lane_dependency"; from: string; to: string }
  | { kind: "resource_ownership"; from: string; to: string }
  | { kind: "owned_by"; from: string; to: string }
  | { kind: "timer"; from: string; deadline: number }
  | { kind: "capacity"; from: string; poolId: string }
```

The snapshot records scheduler and lane state versions. Recovery may be applied only if both still match after Tarjan SCC analysis.

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
| `fencingToken` | decimal-string token at event time |
| `lockBackends` | backends at event time |
| `timestamp` | ms |
| `expiresAt` | optional TTL |
| `error` | on rejected/stale |

---

## MergeGateResult

| Field | Semantics |
|-------|-----------|
| `passed` | `violations.length === 0` |
| `violations` | Blocking human-readable failure strings only |
| `advisoryWarnings` | Non-blocking evidence/quality warnings; never requires a whole-swarm retry |
| `findings` | Structured `{ code, severity, message, retryable, remediation? }` records |
| `retryDisposition` | `not_needed` \| `targeted_probe` \| `targeted_repair` \| `retry_after_recovery` \| `do_not_retry` |
| `mergeAudit` | `MergeSafetyAudit` — overlaps, missing evidence, placeholders |
| `replayIntegrity` | Replay artifact validation |
| `failedLaneCount` | Count of failed lanes |
| `orphanedClaimCount` | Lock-required orphans only |
| `staleLeaseCount` | Excludes lock-skipped lanes |
| `splitBrainDetected` | Multiple owners per resource |
| `sealedSupersessionBlocked` | Unsafe retry over sealed receipt |

The newer structured fields are optional when reading historical schema-v3 receipts and always populated on newly sealed receipts. This preserves on-disk compatibility without a schema migration.

**Required checks:** mutation/claim safety, lane terminal consistency, replay integrity, and authoritative roadmap reconciliation.

**Advisory checks:** missing evidence references, placeholder text, transcript pointers, and tool evidence. These remain visible through `mergeAudit`, diagnostics, and the incident console without changing `passed`.

The swarm envelope mirrors this split through `SwarmInvariantReport.violations` (structural/integrity failures) and optional `advisoryWarnings` (missing evidence or transcript pointers). Resume integrity accepts advisory-only envelopes but still rejects malformed schemas, task/checksum mismatch, transcript corruption, and invalid compaction anchors.

## Confidence-aware convergence package fields

The receipt persists the behavioral decision described above in `confidenceAwareConvergence`.

| Field | Semantics |
|-------|-----------|
| `decision` | `converge`, `converge_with_uncertainty`, `targeted_probe`, `restart_invalid_lane`, or `block_hard_failure` |
| `acceptedFindings` | Valid high/medium-confidence findings with original evidence and lane provenance |
| `tentativeFindings` | Valid low/unknown-confidence findings, retained without confidence inflation |
| `rejectedFindings` | Findings excluded because their source execution was structurally invalid |
| `taskAmbiguityProfile` | Vague-task reasons and whether explicit assumptions are allowed |
| `unresolvedContradictions` | Classified scope, assumption, timeframe, evidence, claim, or mutation conflicts |
| `probeHistory` | Bounded critical-claim probes, evidence deltas, tool sequence, fingerprint, and plateau state |
| `uncertaintySummary` | Known causes, affected claims, safe-to-proceed decision, and evidence needed to resolve uncertainty |
| `diagnostics` | Separate invalidity, low-confidence, ambiguity, probe, plateau, bounded-uncertainty, and hard-block counters/events |

New receipts always populate the package. It remains optional when loading historical schema-v3 receipts so no on-disk migration is required.

---

## GovernedReceiptSummary (UI / live)

Aggregated view in `GovernedReceiptPanel`. Not a separate on-disk schema.

| Field group | Contents |
|-------------|----------|
| Counts | `laneCount`, `lanesSealed`, `lanesRunning`, `orphanedClaims`, … |
| `laneStates[]` | Per-lane: status, `executionMode`, `lockRequired`, reasons, read/write sets, `agentRoadmapId`, `proposedWorkspacePatch`, `localRoadmapEvents` |
| `laneDag[]` | DAG nodes with state |
| `claimTimeline[]` | Operator-friendly claim events |
| `resourceOwners[]` | Active/released/stale ownership |
| `retryHistory[]` | Attempt lineage |
| `diagnostics` | `incident`, `retrySafe`, `retryDisposition`, overlap lists, replay causes, projection fields |
| `violations` | Blocking merge-gate violations |
| `advisoryWarnings` | Visible quality findings that do not block seal |
| `roadmapLinkage` | Full roadmap linkage including `patchReconciliation`, `workspaceCommit` |
| `confidenceAwareConvergence` | Parent convergence package with accepted/tentative/rejected findings and bounded uncertainty |

### GovernedReceiptDiagnostics (projection fields)

| Field | Semantics |
|-------|-----------|
| `workspaceRoadmapSnapshotId` | Current workspace snapshot ID |
| `staleProjectionWarnings` | Projections stale vs workspace |
| `rebaseResults` | Rebase outcomes from reconciliation |
| `rejectedPatchReasons` | Human-readable patch rejection reasons |
| `roadmapCommitStatus` | `committed` \| `blocked` \| `skipped` \| etc. |
| `overlappingRoadmapResources` | Legacy merge-audit roadmap overlaps |
| `blockedRoadmapWriters` | Agents blocked from direct roadmap writes |
| `roadmapCompletionAdvisory` | Completion policy advisory message |

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

**Excluded from hash:** `claimHistory`, lock fields, `executionMode`, `readSet`, `writeSet`, fencing tokens, projection fields (`agentRoadmapId`, `proposedWorkspacePatch`, `localRoadmapEvents`).

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
