---
title: "Completion Authority Migration"
sidebarTitle: "Completion Migration"
description: "Historical migration from split completion gates to CompletionFunnel and transactional task lifecycle."
---
{/* [LAYER: INFRASTRUCTURE] */}

# Completion authority migration

This page records the completed migration away from split completion and lifecycle writers. It is historical context, not a compatibility contract.

## Before

Completion eligibility, finalization routing, circuit state, terminal persistence, in-memory terminal status, resume behavior, and webview status were spread across handlers, snapshot/decision helpers, task booleans, and UI inference.

The split produced two different questions with competing answers:

- “Is the task semantically and durably complete?”
- “What lifecycle state is this task generation in?”

## Modern authority split

| Question | Sole authority |
| --- | --- |
| May this tool operation dispatch? | `ExecutionFunnel` |
| Is the task semantically and durably complete? | `CompletionFunnel` |
| What state/outcome is this task generation in? | `TaskLifecycleFunnel` |

`CompletionFunnel` owns its entire semantic transaction and durable `task_completions` result. It then submits one `SettleCompletion` fact to `TaskLifecycleFunnel`. The lifecycle funnel commits terminal `completed` for the exact generation and publishes the immutable lifecycle event.

## Removed ownership

- The former standalone completion snapshot builder, lifecycle decision engine, action guard, gate registry, and canonical projection were removed as independent authorities.
- `AttemptCompletionHandler` is an adapter into `CompletionFunnel`.
- Task booleans and direct terminal setters no longer encode lifecycle truth.
- Generic resume bookkeeping cannot demote or reactivate a terminal generation.
- UI no longer reconstructs terminal status from transcripts, receipts, or completion-shaped events.
- `run_finalization` remains optional documentation/ledger maintenance and has no lifecycle authority.

Diagnostic helpers such as `completionGatePipeline.ts` and `attemptCompletionUtils.ts` remain advisory inputs used by the monolith. They cannot authorize completion or write lifecycle state.

## Modern transaction

```text
attempt_completion tool admission
  → ExecutionFunnel permit and operation event
  → CompletionFunnel evidence/gates/durable semantic CAS
  → SettleCompletion(task, generation, completion event)
  → TaskLifecycleFunnel generation/revision CAS
  → immutable lifecycle event
  → UI projection
```

Tool execution success alone leaves lifecycle active.

## References

- [Completion funnel](completion-lifecycle-decision-engine.md)
- [Task lifecycle authority](task-lifecycle-authority.md)
- [Central execution funnel](parent-thread-execution-authority.md)
