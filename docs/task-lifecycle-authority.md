---
title: "Task Lifecycle Authority"
sidebarTitle: "Task Lifecycle"
description: "The transactional, generation-bound authority for task state, cancellation, resume, and terminalization."
---
{/* [LAYER: INFRASTRUCTURE] */}

# Task lifecycle authority

`src/core/task/lifecycle/TaskLifecycleFunnel.ts` is the sole production authority that decides and commits task lifecycle transitions.

> Exactly one authority may decide and commit a task lifecycle transition.

Every accepted transition names a task, generation, typed intent, and causal source. The funnel validates the current durable record, commits the next revision and its event atomically, and publishes only the committed immutable event. Callers cannot submit replacement state objects.

## Canonical surfaces

| Concern | Canonical surface |
| --- | --- |
| Transition policy and publication | `src/core/task/lifecycle/TaskLifecycleFunnel.ts` |
| SQLite and in-memory test persistence | `src/core/task/lifecycle/TaskLifecyclePersistence.ts` |
| Shared records, events, intents, and rejections | `src/shared/lifecycle/taskLifecycleEvent.ts` |
| SQLite schema bootstrap | `src/infrastructure/db/Config.ts` |
| Read-only task projection | `src/core/task/TaskState.ts` |
| Mutation boundary check | `scripts/check-task-lifecycle-boundary.mjs` |

`TaskState.lifecycleFunnelRecordJson`, `lifecycleFunnelEventJson`, and `lifecycleFunnelHistory` are projections written only by the funnel. `TaskState.executionGeneration` and `TaskState.abort` are read-only views of that projection.

## State model

The broad lifecycle and terminal outcome are separate:

```text
registered ──activate──▶ active ──suspend──▶ suspended
                            ▲                    │
                            └────resume──────────┘

registered / active / suspended ──settle──▶ terminal

terminal outcome = completed | cancelled | failed | timed_out
```

A cancellation request does not invent another broad state. It changes the record's cancellation substate from `none` to `requested`, increments the lifecycle revision, and immediately fences new execution. `SettleCancellation` is a later, separate transition to terminal `cancelled`.

Terminal means terminal for one generation. A terminal generation cannot become active or suspended. Continuing a terminal task requires `ResumeWithGeneration` with a fresh generation identifier.

## Transaction sequence

Every request follows one causal sequence:

1. Receive a typed transition intent.
2. Resolve the task and target generation.
3. Load the authoritative lifecycle record.
4. Reject unknown, stale, malformed, or replayed intents.
5. Validate the transition against the state machine.
6. Validate causal and attached parent/child constraints.
7. Apply the documented terminal-conflict policy.
8. Compare-and-swap the expected generation and lifecycle revision.
9. Persist the record and event in the same transaction.
10. Freeze and publish the one committed event.
11. Return the committed record/event pair or a typed rejection.

No event is published before commit. Persistence failure returns `persistence_failed` and leaves task projections unchanged. A stale compare-and-swap returns `compare_and_swap_failed`; it never overwrites a newer revision. Runtime schema guards reject malformed records, contradictory terminal fields, and a referenced event that does not exactly match the record.

## Typed intent contract

Callers may request only these operations:

- `RegisterGeneration`
- `ActivateGeneration`
- `SuspendGeneration`
- `ResumeWithGeneration`
- `RequestCancellation`
- `SettleCancellation`
- `SettleCompletion`
- `SettleFailure`
- `SettleTimeout`
- `PropagateParentTermination`

Each intent includes an idempotency identity, task ID, generation ID, and `TaskLifecycleCause`. Causes name the source, a reason, and optional originating operation/event identifiers. A semantic authority may also provide `authoritativeAt` to order a durable fact against an existing cancellation fence.

## Generation and resume rules

- Registration creates revision 1 in `registered`; activation is a separate committed revision.
- A suspended generation resumes only through an explicit same-generation `ResumeWithGeneration`.
- A terminal generation requires a different `newGenerationId`.
- Generation replacement is one compare-and-swap commit; it clears terminal and cancellation state in the new generation.
- A callback, permit, event, or intent carrying generation N is rejected after N+1 becomes current.
- Parent generation replacement is blocked while an attached child of the old generation remains non-terminal.
- Restore loads the durable generation, revision, and referenced last event through the persistence adapter, then projects them together. A missing event fails closed. Storage never activates or repairs lifecycle state itself.

## Cancellation and terminal conflicts

The conflict policy is causal and fail-closed:

1. A committed terminal record is immutable. Any later conflicting settlement for that generation is rejected.
2. A committed cancellation request fences new execution immediately.
3. Cancellation settlement requires the recorded request; a cancellation boolean or late callback is insufficient.
4. Failure, timeout, and completion facts after the cancellation fence are rejected.
5. A completion fact durably committed before the cancellation request may win when its `authoritativeAt` proves that ordering.
6. A completion fact without that evidence does not bypass a pending cancellation.
7. Duplicate intent IDs are rejected from durable event history. Concurrent writers serialize through compare-and-swap, so one revision commits and stale writers receive a typed rejection.

This preserves the distinction between semantic ownership and lifecycle ownership. `CompletionFunnel` decides whether completion is valid and supplies the authoritative fact; `TaskLifecycleFunnel` commits the lifecycle transition without re-running completion policy.

See [Task cancellation](task-cancellation.md) for runtime fencing and [Resume and recovery](task-resume-recovery.md) for restoration behavior.

## Parent and child policy

Children declare a `TaskParentLink` as either `attached` or `detached`.

- An attached child can register only against the exact active, unfenced parent generation.
- Parent cancellation request propagates a typed cancellation request to every active attached child.
- Parent cancellation settlement propagates typed cancellation settlement.
- Parent failure and timeout propagate `PropagateParentTermination` with the same outcome.
- Attached-child execution admission revalidates the exact parent generation. If a process stops after the parent commit but before every child commit, the child is fenced immediately and restoring the parent replays the missing typed propagation.
- Detached children receive no propagation and govern their own lifecycle.
- Child completion after parent cancellation or terminalization is rejected. Completion committed before the parent fence remains terminal.
- Parent completion and parent generation replacement are blocked while attached children remain active.
- Completion is not propagated from parent to child; governed children must terminalize from their own semantic result.

Subagents create unique child task identifiers and bind to the same `TaskLifecycleFunnel` instance as the parent. There is no sibling, subagent, or coordinator lifecycle shortcut.

## Persistence and publication

Production persistence uses:

- `task_lifecycle_records` for the current record per task;
- `task_lifecycle_events` for immutable intent/event history;
- `task_lifecycle_sequence` for global monotonic ordering.

`BEGIN IMMEDIATE` contains generation/revision comparison, parent constraints, sequence allocation, current-record update, and event insert. Publication happens only after commit. The in-memory adapter mirrors the same contract for focused tests.

Events defensively clone and recursively freeze caller metadata before publication. Consumers cannot mutate authoritative history. Listener failure is observational and cannot roll back or reinterpret a committed transition.

## Relationship to other authorities

| Authority | Owns | Lifecycle relationship |
| --- | --- | --- |
| `ExecutionFunnel` | Approval, permits, dispatch, execution terminal classification | Queries lifecycle eligibility and submits lifecycle facts; never writes task state |
| `CompletionFunnel` | Semantic and durable completion decision | Submits one `SettleCompletion` fact after durable completion commits |
| `TaskLifecycleFunnel` | Task generation/state transition and lifecycle event commit | Does not reinterpret execution or completion semantics |
| `LockAuthority` | Mutation lease and fencing | Unchanged; not a task lifecycle writer |
| UI and transport | Presentation | Consume the latest lifecycle event; never synthesize terminal state |
| Storage | Atomic record/event durability | Applies compare-and-swap; never chooses a transition |

Tool execution success is not task completion. An `operation_succeeded` execution event leaves the task lifecycle active. Only a committed completion fact from `CompletionFunnel` can produce terminal `completed`.

## Boundary enforcement

`npm run check:task-lifecycle-boundary` rejects production code that:

- assigns lifecycle projection fields outside `TaskLifecycleFunnel`;
- assigns the old cancellation, terminal, or generation fields;
- writes lifecycle tables outside the persistence adapter/schema bootstrap;
- imports internal lifecycle persistence, constructs another funnel, binds authority outside the task/subagent adapters, or uses the in-memory test authority in production code;
- reintroduces direct terminal or generation setters.

Test fixtures may construct state for isolated assertions, but production mutation is funnel-only.

## Validation

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config \
  --timeout 10000 --exit --extension ts \
  --require ts-node/register \
  --require tsconfig-paths/register \
  --require source-map-support/register \
  --require ./src/test/requires.cjs \
  src/core/task/lifecycle/__tests__/TaskLifecycleFunnel.test.ts \
  src/core/task/tools/execution/__tests__/ExecutionFunnel.test.ts \
  src/core/task/tools/completion/__tests__/CompletionFunnel.test.ts

npm run check:task-lifecycle-boundary
npm run check-types
npm run test:unit
npm run lint
npm run ci:build
```

## Invariants

- One funnel commits every production task lifecycle transition.
- Every transition is generation-bound and revision-checked.
- Cancellation request and cancellation settlement are distinct durable facts.
- Terminal generations never reactivate.
- Resume never ambiguously revives a terminal generation.
- Persistence cannot asynchronously overwrite a newer lifecycle revision.
- Parent, sibling, and subagent paths use the same authority.
- UI and storage are projections/adapters, not decision makers.
- Execution success cannot complete a task.
