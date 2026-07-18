{/* [LAYER: INFRASTRUCTURE] */}

# Completion & Finalization Gate — Reference

Modern-only execution model for engineering verification, same-session finalization, and sealed receipts. No legacy compatibility layer.

## The completion spine

Completion eligibility flows through a deterministic four-stage spine. This is the architecture that replaced the scattered decision logic described in the migration sections below.

| Stage | Role | Source |
|-------|------|--------|
| **Snapshot builder** | Reads mutable task state once, produces an immutable `CompletionLifecycleSnapshot` | `completionSnapshotBuilder.ts` |
| **Decision engine** | Pure function over the snapshot — returns one canonical decision with a full trace | `CompletionLifecycleDecisionEngine.ts` |
| **Action contract** | The decision carries `nextAllowedAction`, `forbiddenActions`, and a one-line `canonicalInstruction` | `CompletionLifecycleTypes.ts` |
| **Action guard** | Enforces the contract at the tool boundary — rejects forbidden actions without mutating counters | `CompletionActionGuard.ts` |

> **The agent receives a command, not a prose explanation to interpret.**

This closed the failure chain that motivated the migration:

> stale state → ghost audit → wrong interpretation → retry loop → circuit breaker spiral

Replacing it with:

> snapshot → decision → permitted action → guard enforcement

Full architecture: [Completion lifecycle decision engine](completion-lifecycle-decision-engine.md).

## Architecture

```mermaid
stateDiagram-v2
    [*] --> engineering_in_progress
    engineering_in_progress --> engineering_verified: attempt_completion passes audit
    engineering_verified --> finalization_ready: docs/ledger pending OR retry-lock
    finalization_ready --> finalization_running: run_finalization
    finalization_running --> finalization_completed: artifacts validated
    finalization_completed --> receipt_sealed: evidence passed
    receipt_sealed --> completed_without_retry_completion: run_finalization seal=true
    engineering_in_progress --> completion_retry_locked: circuit breaker
    completion_retry_locked --> finalization_ready: engineering verified
    engineering_in_progress --> audit_gate_corrupt: invariant / access failure
```

## Canonical lifecycle (`GateLifecycleState`)

| State | Meaning | Typical next action |
|-------|---------|---------------------|
| `engineering_in_progress` | Engineering work or audit preflight in flight | `attempt_completion`, `run_verification` |
| `engineering_verified` | Audit/preflight passed; checkpoint latched | `run_finalization` |
| `finalization_ready` | Docs/ledger pending; authorized finalization lane | `run_finalization` |
| `finalization_running` | Authorized finalization executing | wait |
| `finalization_completed` | Evidence collected; ready to seal | `seal_session` |
| `receipt_sealed` | Finalization validated; seal pending | `run_finalization seal=true` |
| `completed_without_retry_completion` | Sealed receipt emitted; terminal success | none |
| `completion_retry_locked` | `attempt_completion` forbidden (403 analogue) | `run_finalization` when verified |
| `audit_gate_corrupt` | Invariant or access failure; fail-closed | operator guidance only |

Allowed transitions are enforced by `GateLifecycleEvaluator` + `gateLifecycleInvariants.ts`. Unknown states throw via `assertExhaustiveGateLifecycleState`.

## Dual lanes

| Lane | Tool | Owns |
|------|------|------|
| Completion | `attempt_completion` | Engineering verification only |
| Finalization | `run_finalization` | Docs, ledger, roadmap stamp, receipt |

`attempt_completion` does **not** own finalization. After engineering is verified, documentation and ledger work use `run_finalization` in the **same session**.

## `AuditGateDecision` (audit score gate)

Defined in `src/shared/audit/auditGateReport.ts`. Evaluated via `evaluateAuditGate()`.

```typescript
interface AuditGateDecision {
  blocked: boolean
  score: number
  effectiveThreshold: number
  grade: TaskAuditMetadata["hardening_grade"]
  reasons: CompletionGateReason[]
}
```

Nested inside `GateLifecycleDecision.auditDecision` when relevant. This is **not** a lifecycle state.

## `GateLifecycleDecision` (operator gate)

Defined in `src/shared/completion/gateLifecycleDecision.ts`. Produced by `evaluateGateLifecycle()`.

```typescript
interface GateLifecycleDecision {
  lifecycleState: GateLifecycleState
  activeLane: "completion" | "finalization" | "none"
  reasonCode: GateReasonCode
  operatorMessage: string
  engineering: GateAxisStatus
  verification: GateAxisStatus
  documentation: GateAxisStatus
  ledger: GateAxisStatus
  finalization: GateAxisStatus
  allowedActions: GateAction[]
  forbiddenActions: GateAction[]
  recoveryPath: GateRecoveryStep[]
  receiptEligible: boolean
  moreToolCallsUseful: boolean
  userInputRequired: boolean
  finalizationEvidence?: FinalizationEvidence
  completionReceipt?: CompletionReceipt
  auditDecision?: AuditGateDecision
  evaluatedAt: number
}
```

Published to:
- `TaskState.lastGateLifecycleDecision`
- `TaskState.lifecycleTransitionLogJson` (append-only continuity)
- `DietCodeMessage.gateLifecycleStatus` (live webview)

## Same-session finalization

1. Engineering passes → `engineeringVerifiedAt` latched → `engineering_verified`
2. Retry-lock + verified → `finalization_ready` (not session-dead)
3. `run_finalization` → updates `.wiki/changelog.md`, stamps ledger, validates roadmap
4. `run_finalization seal=true` → sealed `CompletionReceipt`, `completed_without_retry_completion`

No new task/session required for finalization.

## Sealed receipt requirements

`CompletionReceipt` (`src/shared/completion/finalizationEvidence.ts`) requires:

- `engineeringVerifiedAt` (+ optional checkpoint hash)
- `finalizationEvidence` with `status: "passed"`, `docsUpdated`, `ledgerStamped`, `artifactPaths`
- `lifecycleTransitionHistory` (engineering + finalization transitions)
- `gateReasonCode`
- `continuityMarker` (`taskId:receiptId:sealedAt`)
- `sealedAt`

Validated by `src/shared/completion/receiptValidation.ts`. Summary text alone cannot produce a receipt.

## Authorized wiki policy

`.wiki/` writes allowed only when:
- `finalizationMode === true` (during `run_finalization`), or
- `isSubagentExecution === true`

Enforced in `WriteToFileToolHandler`, `ApplyPatchHandler` via `isWikiWriteAuthorized()`. Policy denial surfaces as `finalization.access_denied` / `audit_gate_corrupt`, distinct from validation failure.

## UI state model

`GateLifecycleStatusPanel` in task header (`TaskNotesSection`) consumes `resolveGateLifecycleSnapshot(messages)` — includes freshness and continuity marker.

Display order:
1. Headline badge (`getGateLifecycleHeadline`) + freshness (`evaluatedAt`)
2. Human operator sentence (`operatorMessage`)
3. Structured axes + next/avoid actions
4. Collapsible evidence (finalization preview, receipt id)

Retry-lock with verified engineering shows amber **Retry Locked — Recoverable**, not engineering failure.

## Subagent parity

`validateSubagentCompletionGates()` runs the same preflight pipeline and publishes `GateLifecycleDecision`. The decision is persisted on `SubagentExecutionEnvelope.gateLifecycleStatus`. Envelope validation requires `gateLifecycleStatus` when `phase === "completion_gate"`.

## Execution funnel and completion boundary

Completion and finalization gates remain **cold-path authoritative** — they block at `attempt_completion` when engineering verification fails.

Inner-loop tools enter one **central execution funnel**. Its query classification keeps reads and searches fast, while mutations and side effects traverse the full governed stage sequence:

| Concern | Cold path (blocks) | Hot path (non-blocking) |
|---------|-------------------|-------------------------|
| Engineering audit score | `evaluateCompletionAuditGate` at `attempt_completion` | Deferred act-mode / command advisories |
| UniversalGuard | Governed mutations and side effects | Workspace queries use the funnel's I/O fast path |
| Preflight | Quality, roadmap (when enabled), circuit breaker | `cooldown`, `duplicate` soft stages |
| Audit cache | Fresh `runCompletionAudit` when needed | 5-min TTL on unchanged result + advisory reuse |

See **[Central execution funnel](parent-thread-execution-authority.md)** for the permit boundary, event schema, complete stage order, and operator diagnosis.

### Failure messages and why completion blocks

When `attempt_completion` fails, the agent receives a structured error — not a generic denial. Common categories:

| Category | Example message fragment | Meaning |
|----------|-------------------------|---------|
| **Preflight quality** | `Completion rejected: result is too brief` | Summary failed shape/tone checks before audit |
| **Focus chain** | `focus chain has N incomplete item(s)` | Todo list not fully checked off |
| **Roadmap** | Roadmap service remediation text | Workspace roadmap item blocked completion |
| **Audit gate** | `Grade F (20/100, threshold 50)` | Hardening score or violations failed cold path |
| **Circuit breaker** | `maximum completion gate retries (10) exceeded` | Retry budget exhausted — see lifecycle states below |
| **Double-check** | `re-verify your work` | Two-step completion gate pending |

Tool-level execution blocks such as plan mode, fencing, collisions, roadmap policy, hooks, and cancellation are recorded by the **[central execution funnel](parent-thread-execution-authority.md#failure-diagnosis)**. Completion-specific failures remain in the completion event and durable terminal record.

Gate block events append to `completionGateBlockHistory` (ring buffer) and publish `gateLifecycleStatus` to the webview via `GateLifecycleStatusPanel`.

## Fast-Path & Completion Speed Optimizations

To make completion feel immediate when the state is already valid (the "happy path"), the following optimizations are implemented:

### 1. True Fast Path Execution
In `AttemptCompletionHandler`, the system checks:
- The canonical snapshot is fresh (`current` freshness).
- The cached audit is valid (same checkpoint hash and same graph revision).
- Gate readiness is ready or completing (engineering is passed).
- No blocker count exists.
- The graph revision has not changed since the last attempt.

If these conditions are met, the system bypasses all preflight checks, double-checks, forensic compliance, and audit gate pipelines, completing immediately.

### 2. Collapsed Ready & Completed Phases
Transitional ready states are collapsed to prevent lingering in intermediate steps:
- `engineering_verified`, `finalization_ready`, and `finalization_running` map to `completing`.
- `finalization_completed` maps directly to `finalized`.

### 3. Artificial Wait Suppression
- **Reconciliation Debounce**: Debounce waits are bypassed immediately when readiness is known/verified (the `engineeringVerified` status is passed to `isWithinReconciliationDebounce`).
- **Retry Cooldowns**: Exponential backoff timers (`getCompletionCooldownRemainingMs`) return 0 if the completion lifecycle is in a ready/completing/finalized phase.
- **Breather Nudge**: The cognitive reflection breather nudge is skipped in the task runner if completion readiness has been verified.

### 4. UI Chatter & Freshness Suppression
When the engineering gate status is passed, `resolveGateLifecycleSnapshot` forces snapshot freshness to `"current"`. This prevents the UI from showing transitional `"stale"` or `"synchronizing"` statuses.

### 5. Revision-Aware Caching
Gate lifecycle decisions and audit gate results are cached and validated against both the workspace checkpoint hash and the active completion graph revision (ignoring the 5-minute TTL when the graph revision matches).

## Centralized decision engine (v2.9.0+)

All completion eligibility decisions now flow through a single deterministic authority: `CompletionLifecycleDecisionEngine`. No handler, utility, or pipeline stage may independently decide completion eligibility.

**See:** [Completion lifecycle decision engine](completion-lifecycle-decision-engine.md) for full architecture, action contract, and enforcement model.

### Key changes from the hardening passes

1. **Audit cache validity** changed from OR logic to strict AND: cache key + graph revision + TTL + gate active must ALL match. A stale audit can no longer be reused when only one dimension holds.

2. **Circuit breaker half-open probe** (Hystrix/Envoy pattern): when the circuit breaker trips and engineering is NOT verified, the agent can make workspace changes to earn one probe attempt. Exactly one probe per checkpoint, tracked via `lastProbeCheckpointHash` on `TaskState`.

3. **Workspace-unchanged detection** (`workspace_progress` stage): blocks retries when the workspace hasn't changed since the last gate block, even if the result text was reworded. Soft block — does not consume circuit-breaker budget.

4. **Binding action contract**: every decision carries `nextAllowedAction`, `forbiddenActions`, and `canonicalInstruction`. The `CompletionActionGuard` enforces the contract at the tool boundary — rejected actions never mutate counters, create audit state, or trigger retries.

5. **Gate registry**: unknown or retired gates are non-participating (not blocking). The registry distinguishes "never existed" from "was retired" for trace clarity.

### Decision engine pipeline

```
evaluate(snapshot)
  → normalize inputs
  → validate active registry
  → evaluate engineering verification
  → evaluate finalization routing (explicit, not emergent)
  → evaluate audit validity (strict AND)
  → evaluate circuit breaker (closed / tripped / half_open)
  → evaluate workspace progress
  → evaluate duplicate attempt
  → return one canonical decision with action contract + full trace
```

### Action contract

| Decision | nextAllowedAction | forbiddenActions |
|----------|-------------------|-----------------|
| `allow_attempt` | `attempt_completion` | `[]` |
| `allow_probe` | `attempt_completion` | `[]` |
| `route_to_finalization` | `run_finalization` | `["attempt_completion"]` |
| `soft_block` | `modify_workspace` | `["attempt_completion", "run_finalization"]` |
| `hard_block` | `stop_and_report` | `["attempt_completion", "run_finalization"]` |

The agent does not interpret lifecycle state. It receives a command. The decision engine determines truth. The action guard enforces truth. The agent only executes the permitted next action.

### New source files

| File | Role |
|------|------|
| `completion/CompletionLifecycleTypes.ts` | Immutable snapshot input, canonical decision output, action contract types |
| `completion/CompletionLifecycleDecisionEngine.ts` | Single deterministic authority — pure function, no side effects |
| `completion/CompletionActionGuard.ts` | Enforcement layer — validates tool against action contract, rejects without counter mutation |
| `completion/gateRegistry.ts` | Active/retired gate registry |
| `completion/completionSnapshotBuilder.ts` | Adapter — normalizes TaskConfig/TaskState into immutable snapshot |

## Invariants (`gateLifecycleInvariants.ts`)

- Retry-locked verified engineering must allow `run_finalization`
- Retry-locked unverified engineering must **not** allow `run_finalization`
- Terminal states must not require more tool calls
- Finalization success requires artifact evidence
- Sealed completion requires `completionReceipt`
- No fake `ask_followup_question` when machine-readable recovery exists (`fakeFollowupGuard.ts`)

## Regression guardrails

Tests in:
- `src/core/task/tools/completion/__tests__/decisionEngine.test.ts` — decision engine acceptance criteria (28 tests)
- `src/core/task/tools/completion/__tests__/actionGuard.test.ts` — action guard enforcement, no counter mutation, prose-override prevention (21 tests)
- `src/core/task/tools/completion/__tests__/falsePositivePrevention.test.ts` — circuit breaker half-open, workspace progress, duplicate detection (21 tests)
- `src/core/task/tools/completion/__tests__/gateLifecycleAudit.test.ts`
- `src/core/task/tools/completion/__tests__/gateLifecycleEvaluator.test.ts`
- `src/core/task/tools/completion/__tests__/fakeFollowupGuard.test.ts`
- `src/core/task/tools/finalization/__tests__/finalizationRunner.test.ts`
- `src/shared/audit/__tests__/completionAuditResilience.test.ts` — audit infra resilience
- `webview-ui/.../GateLifecycleStatusPanel.test.tsx`

## Removed legacy behavior

Not exported or used:
- `CompletionGateDecision` alias on audit gate
- `evaluateCompletionGate` alias
- `completion_gate_corrupt`, `receipt_ready`, `completion_gate_retry_locked` lifecycle names
- Recovery copy: “start a new task”, “new session required”
- `attempt_completion` as documentation trigger
- `CompletionGateStatusPanel` (renamed to `GateLifecycleStatusPanel`)

## Intentionally retained `CompletionGate*` names

| Name | Scope | Why retained |
|------|-------|--------------|
| `CompletionGateOptions` | Audit settings | Audit threshold config, not lifecycle model |
| `auditCompletionGateEnabled` etc. | User settings keys | Persisted setting identifiers |
| `buildCompletionGate*` XML helpers | Agent observability | Externally consumed structured blocks in tool errors |
| `evaluateGatePreflightReadiness` | Dry-run preflight | Renamed from `evaluateCompletionGateReadiness` — readiness probe, not lifecycle |
| `runCompletionGateFlow` | Preflight pipeline | Orchestrates audit + quality gates |
| `RoadmapCompletionGate` | Roadmap service | Domain-specific roadmap gate |
| `CompletionGateReason` | Audit reason codes | Part of `AuditGateDecision.reasons` |

## Migration from old artifacts

| Old | Modern |
|-----|--------|
| `lastCompletionGateDecision` | `lastGateLifecycleDecision` |
| `completionGateStatus` on messages | `gateLifecycleStatus` |
| `CompletionGateEvaluator` | `GateLifecycleEvaluator` |
| `CompletionGateStatusPanel` | `GateLifecycleStatusPanel` |
| `receipt_ready` | `receipt_sealed` |
| `completion_gate_retry_locked` | `completion_retry_locked` |
| `completion_gate_corrupt` | `audit_gate_corrupt` |

## Legacy trap eliminated

### Original failure shape

Engineering passed and completion retry-locked, but operators were told to start a new task/session for wiki/docs work. `attempt_completion` owned finalization; retry-lock felt session-dead; fake `ask_followup_question` could escape machine-readable recovery.

### Modern transition path

```
engineering verified (latched)
  → completion_retry_locked + finalization_ready
  → run_finalization (same session)
  → receipt_sealed
  → run_finalization seal=true
  → completed_without_retry_completion
```

### Invariant that prevents recurrence

- `gateLifecycleInvariants.ts`: retry-locked verified engineering **must** allow `run_finalization`; unverified retry-lock **must not**
- `fakeFollowupGuard.ts`: rejects follow-up when recovery path exists
- `receiptValidation.ts`: sealed receipts require artifact + lifecycle history — no summary-only receipts
- `wikiWritePolicy.ts` + tool handlers: unauthorized `.wiki` writes blocked at runtime
- `resolveGateLifecycleSnapshot()`: UI shows freshness (`current` / `stale` / `unknown`) and continuity marker

### Same-session finalization recipe

1. Pass engineering gates → `attempt_completion` latches `engineeringVerifiedAt`
2. If retry-locked → call `run_finalization` (not `attempt_completion`, not new task)
3. When finalization validates → `run_finalization seal=true`
4. Receipt emitted with evidence; session terminal

### Closeout tests

- `gateLifecycleCloseout.test.ts` — full trap reproduction + receipt + subagent parity
- `gateLifecycleAudit.test.ts` — regression guardrails
- `gateLifecycleMessages.test.ts` — freshness classification
- `GateLifecycleStatusPanel.test.tsx` — stale snapshot UI

### No remaining architectural unknowns

The completion/finalization system is **closed**. Runtime behavior, UI, prompts, subagent envelopes, and docs align on the modern-only model.
