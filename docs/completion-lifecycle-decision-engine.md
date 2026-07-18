---
title: "Completion Funnel"
sidebarTitle: "Completion Funnel"
description: "The semantic completion authority and its handoff to transactional task lifecycle."
---
{/* [LAYER: INFRASTRUCTURE] */}

# Completion funnel

`src/core/task/tools/completion/CompletionFunnel.ts` is the sole semantic authority that decides whether a task is durably complete.

It is intentionally separate from:

- `ExecutionFunnel`, which admits and classifies one tool operation; and
- `TaskLifecycleFunnel`, which commits generation-bound task state.

> Tool execution success is not task completion.

## Ownership

| Concern | Authority |
| --- | --- |
| Completion evidence, gates, action eligibility, canonical identity, durable completion CAS, and completion event | `CompletionFunnel` |
| Task lifecycle state and terminal outcome | `TaskLifecycleFunnel` |
| Tool approval, permit, dispatch, and operation terminal event | `ExecutionFunnel` |
| Completion/lifecycle display | UI projection only |

The durable semantic result remains the `task_completions` row. After that result commits, `CompletionFunnel` submits one generation-bound `SettleCompletion` fact to `TaskLifecycleFunnel`. The lifecycle funnel validates the current task generation and cancellation fence, commits terminal outcome `completed`, and publishes the immutable lifecycle event.

Neither funnel duplicates the other:

- `CompletionFunnel` does not assign terminal task state.
- `TaskLifecycleFunnel` does not re-run completion gates or infer semantic success.
- UI does not treat a completion-shaped transcript, receipt, or successful tool event as lifecycle truth.

## Ordered completion transaction

The completion monolith owns the complete semantic transaction:

1. Collect one canonical completion snapshot.
2. Evaluate the registered gates in deterministic order.
3. Produce one binding next action or terminal decision.
4. Compute the canonical completion identity.
5. Validate the current coordination lease and task state version.
6. Commit or load the durable `task_completions` record.
7. Submit the durable completion fact to `TaskLifecycleFunnel`.
8. Publish the terminal `CompletionFunnelEvent` only after lifecycle commit succeeds.

This ordering prevents a completion UI event from racing ahead of task lifecycle truth.

## Durable completion identity

The semantic completion identity is a schema-versioned canonical digest over the task, evaluated state version, checkpoint, outcome, and decision schema. The SQLite transaction validates the current lease tuple and state version before inserting the terminal row.

Duplicate and conflict policy:

| Durable condition | Result |
| --- | --- |
| Same decision and payload | Return idempotently |
| Different decision, same terminal outcome | Preserve the existing durable completion |
| Different terminal outcome | Fail closed |
| Same identity, different payload | Treat as corruption/collision and fail closed |

`TaskLifecycleFunnel` then applies its own generation and cancellation laws. A completion fact that durably predates a cancellation request can prove that ordering with `authoritativeAt`; a later or unproven fact cannot bypass the cancellation fence.

## Completion event versus lifecycle event

`CompletionFunnelEvent` explains the semantic completion decision and its gate trace. `TaskLifecycleEvent` explains the committed task-state transition.

Consumers must not merge fields or infer one from the other:

- completion event: “the completion transaction committed”;
- lifecycle event: “generation G transitioned to terminal completed at revision R.”

The webview displays task terminality only from the lifecycle event. The semantic completion event may provide details, but it cannot create, repair, reopen, or override lifecycle state.

## Failure behavior

- Gate denial returns a non-terminal completion event and does not change lifecycle state.
- Durable completion persistence failure cannot publish terminal completion.
- Lifecycle rejection after durable completion is treated as a terminalization error and prevents a false terminal UI event.
- A stale task generation, pending cancellation, active attached child, or conflicting terminal outcome fails closed.
- Execution of `attempt_completion` may itself succeed as a tool operation without independently terminalizing the task.

## Relationship to resume

Resume reads the committed lifecycle record:

- suspended generations may resume explicitly;
- terminal completed generations require a new generation for new user work;
- generic transcript bookkeeping cannot demote or revive terminal state;
- old completion callbacks cannot mutate a replacement generation.

See [Task lifecycle authority](task-lifecycle-authority.md) and [Resume and recovery](task-resume-recovery.md).

## Validation

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config \
  --timeout 10000 --exit --extension ts \
  --require ts-node/register \
  --require tsconfig-paths/register \
  --require source-map-support/register \
  --require ./src/test/requires.cjs \
  src/core/task/tools/completion/__tests__/CompletionFunnel.test.ts \
  src/core/task/lifecycle/__tests__/TaskLifecycleFunnel.test.ts
```

The focused tests prove that a completion fact produces one terminal lifecycle event and that UI completion projections cannot create lifecycle truth.

## Invariants

- Only `CompletionFunnel` decides semantic task completion.
- Only `TaskLifecycleFunnel` commits terminal task lifecycle state.
- Durable semantic completion precedes lifecycle completion submission.
- Terminal completion UI follows lifecycle commit.
- Tool execution success cannot complete a task.
- No transcript, receipt, cache, or compatibility field can synthesize lifecycle terminality.

## Related documentation

- [Task lifecycle authority](task-lifecycle-authority.md)
- [Task cancellation](task-cancellation.md)
- [Central execution funnel](parent-thread-execution-authority.md)
- [Governed execution authority](governed-execution-authority.md)
