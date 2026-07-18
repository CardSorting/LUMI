# MEOW-012: Transactional Task Lifecycle Authority

Status: Accepted  
Date: 2026-07-18

## Context

Task lifecycle truth was encoded by independent mutable fields and callbacks. `TaskState.executionGeneration`, `abort`, `didFinishAbortingStream`, `abandoned`, `isInitialized`, and `isTerminalState` could be changed by task, controller, completion, resume, and cancellation paths. UI helpers inferred terminality from completion-shaped messages, storage restoration copied state without transition validation, and subagents settled their own envelopes without a shared task-generation authority.

Those writers could disagree: cancellation could be requested while another path marked completion, a resumed generation could accept an old callback, and one view could report terminal while another remained pending.

## Decision

`src/core/task/lifecycle/TaskLifecycleFunnel.ts` is the sole production authority for task lifecycle transitions. It accepts typed intents, validates the durable record and generation, applies state and parent/child policy, commits record plus event by compare-and-swap, and publishes exactly one immutable event only after persistence succeeds.

The broad states are:

- `registered`
- `active`
- `suspended`
- `terminal`

Terminal outcomes are separate:

- `completed`
- `cancelled`
- `failed`
- `timed_out`

Cancellation has an explicit `none | requested` substate. The request fences new execution; settlement produces terminal `cancelled`.

## Generation semantics

- Every record, intent, event, permit eligibility query, and parent link names a generation.
- Same-generation resume is legal only from `suspended`.
- Terminal continuation requires an explicit fresh generation.
- Generation replacement is one compare-and-swap transition.
- Old-generation callbacks and replays are rejected, never interpreted against the current generation.
- Parent replacement is blocked while attached children of the old generation remain non-terminal.

## Causal transaction

1. Receive a typed intent.
2. Resolve task and generation.
3. Load the authoritative record.
4. Reject stale, unknown, malformed, or replayed input.
5. Validate the state-machine transition.
6. Validate causal and parent/child constraints.
7. Apply terminal-conflict policy.
8. Compare-and-swap generation and lifecycle revision.
9. Persist record and event together.
10. Publish one recursively frozen event.
11. Return the committed event or typed rejection.

No event is emitted for an uncommitted state.

## Terminal conflict policy

- The first committed terminal lifecycle revision is immutable; later settlements for that generation are rejected.
- A cancellation request is a committed causal fence.
- Cancellation settlement requires that exact pending request.
- Failure, timeout, and completion submitted after the fence are rejected.
- A `CompletionFunnel` fact may beat cancellation only when its durable `authoritativeAt` predates the cancellation request.
- Duplicate intent IDs are rejected from event history.
- Cross-process races serialize by SQLite `BEGIN IMMEDIATE` and generation/revision compare-and-swap; stale writers cannot overwrite the winner.

The lifecycle funnel does not reinterpret another funnel's semantic fact. `CompletionFunnel` owns the durable semantic completion decision; `ExecutionFunnel` owns execution admission and operation classification.

## Parent-child policy

- Attached children register only against the exact active, unfenced parent generation.
- Parent cancellation request and settlement propagate as typed child intents.
- Parent failure and timeout propagate through `PropagateParentTermination`.
- Child admission revalidates the exact attached parent generation. Parent restore replays typed propagation to reconcile a process interruption between the parent and child commits.
- Detached children do not receive propagation.
- Child completion after a parent fence is rejected; a child completion committed before the fence remains terminal.
- Parent completion and generation replacement are blocked until attached children terminalize.
- Parent completion is not copied into children.

## Persistence ordering

Production SQLite owns the current record, immutable events, and global monotonic sequence. One transaction checks the expected generation/revision and parent constraints, advances the sequence, updates the record, and inserts the event. Publication and `TaskState` projection occur only after commit.

Restoration loads and projects the committed record and its referenced event. Runtime guards validate the full schema and their exact task/generation/revision/state/order relationship; malformed, contradictory, missing, or mismatched data fails closed. Restoration does not choose a transition. Because a parent and each child are independent generation records, restoring a fenced or terminal parent retries the same typed child propagation; child admission remains fenced by the durable parent in the interim. In-memory persistence implements the same contract for isolated tests.

## Former authority migration table

| Former writer or inferred authority | Former contract | Classification | Resolution |
| --- | --- | --- | --- |
| `TaskState.executionGeneration` assignment | Activated/replaced generations | Authoritative writer | Removed as writer; read-only projection of committed record |
| `TaskState.abort` assignment | Cancellation and execution stop | Authoritative writer | Removed as writer; read-only cancellation projection |
| `TaskState.didFinishAbortingStream` | Cancellation settlement handshake | Compatibility authority | Deleted; `SettleCancellation` is the settlement |
| `TaskState.abandoned` | Alternate terminal cancellation outcome | Compatibility authority | Deleted; terminal outcome is `cancelled` |
| `TaskState.isTerminalState` | In-memory terminal completion | Authoritative writer | Deleted; lifecycle terminal record is authoritative |
| `TaskState.isInitialized` | Mixed runtime readiness and lifecycle activation | Inferred authority | Split out as task-owned operational readiness; activation uses funnel |
| Task constructor `Object.assign` restoration | Replaced lifecycle fields from history | Restoration bypass | Lifecycle fields filtered; restore/register/migrate through funnel |
| Task start/resume helpers | Reset abort and replace generation | Authoritative writer | Reduced to typed register, activate, suspend, and resume requests |
| `Task.abortTask()` flags | Requested and settled cancellation | Authoritative writer | Transition requester; resource cleanup occurs between request and settlement |
| Controller `cancelInProgress` and abandoned polling | Cancellation truth/repair | Inferred authority | Reduced to request coalescing only; no lifecycle policy |
| `resetState` direct task clearing | Unsettled cancellation shortcut | Compatibility path | Routes through awaited `Controller.clearTask()` |
| Checkpoint restore `isInitialized` polling | Resume readiness inference | Projection | Uses task operational readiness; no lifecycle mutation |
| `CompletionFunnel` terminal setter | Marked task terminal after semantic success | Authoritative writer | Replaced by one `SettleCompletion` fact to lifecycle funnel |
| Completion transcript/message inference | Synthesized terminal UI state | Projection with policy | Removed; UI consumes committed lifecycle event |
| `ExecutionFunnel` abort/generation checks | Execution eligibility from mutable fields | Event consumer | Uses lifecycle eligibility read contract |
| `SubagentRunner` terminal envelopes | Child completion/failure/cancel shortcut | Authoritative writer | Child registers and settles through the same lifecycle authority before envelope publication |
| Parent/subagent callbacks | Direct child/parent termination | Authoritative writer | Replaced by typed propagation intents |
| SQLite task/history restoration | Asynchronous lifecycle overwrite | Persistence bypass | Persistence adapter performs CAS only; funnel decides transitions |
| `TaskState` lifecycle JSON/event/history | Current-state storage | Projection | Written only by funnel after commit |
| Webview status derivation | Repaired/synthesized task terminality | Projection with policy | Consumes `TaskLifecycleEvent`; cannot create state |
| JoyRide `registerTaskLifecycle` | Cache generation bookkeeping | Non-lifecycle cache adapter | Intentionally retained and documented as unrelated to task state |
| Subagent `laneStateMachine` | Lane scheduling state | Execution-lane projection | Intentionally retained; it cannot mutate task lifecycle |
| `task_completions` | Durable semantic completion | Semantic authority | Retained under `CompletionFunnel`; lifecycle consumes its fact |
| `LockAuthority` and swarm leases | Mutation ownership/fencing | Separate authority | Unchanged and intentionally outside lifecycle |

## Boundary enforcement

`scripts/check-task-lifecycle-boundary.mjs` rejects production assignment to removed lifecycle fields, lifecycle projection writes outside the funnel, lifecycle table writes outside the persistence adapter/schema bootstrap, alternate funnel construction, authority binding outside the approved task/subagent adapters, and production imports of the internal persistence or in-memory test authority.

## Consequences

- Task lifecycle state has one source and one ordered audit trail.
- Cancellation, resume, completion, failure, and timeout cannot race through independent booleans.
- Parent, sibling, and subagent execution share generation fencing.
- UI and transport are projections only.
- Storage cannot resolve races or overwrite newer revisions.
- Execution success remains distinct from task completion.
