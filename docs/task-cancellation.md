---
title: "Task Cancellation"
sidebarTitle: "Cancellation"
description: "Transactional cancellation request, execution fencing, and settlement."
---
{/* [LAYER: INFRASTRUCTURE] */}

# Task cancellation

Cancellation is a two-step lifecycle transaction owned by `TaskLifecycleFunnel`.

1. `RequestCancellation` commits a new lifecycle revision with cancellation `requested`.
2. New `ExecutionFunnel` admission and permit validation fail closed for that generation.
3. `Task.abortTask()` signals and joins task-owned in-flight resources.
4. `SettleCancellation` commits terminal outcome `cancelled`.

The request is the execution fence; the settlement is the terminal result. A boolean cannot substitute for either fact. `TaskState.abort` is a read-only projection that is true while cancellation is requested or after terminal cancellation.

Duplicate UI cancellation calls are coalesced by `Controller`, but that promise is not lifecycle authority. It invokes the same task method and returns the funnel result.

## Races

- Cancellation before dispatch prevents permit-protected dispatch.
- Cancellation during execution allows the admitted operation to settle but prohibits another dispatch.
- Completion after the cancellation fence is rejected unless `CompletionFunnel` proves its durable fact predates the request.
- Cancellation after terminal completion is rejected.
- A stale-generation cancellation request is rejected.
- Parent cancellation propagates typed requests and settlements to attached children; detached children are unaffected.

For the full state machine and conflict policy, see [Task lifecycle authority](task-lifecycle-authority.md).
