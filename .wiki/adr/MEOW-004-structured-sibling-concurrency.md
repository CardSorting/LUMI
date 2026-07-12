# MEOW-004: Structured Sibling Concurrency

**Status:** Accepted  
**Implementation:** `src/core/task/tools/siblings/SiblingToolScheduler.ts`

## Context and problem

Sibling tools were recursively awaited through presentation state, so independent reads and searches ran sequentially.

## Decision

Use a bounded scheduler for contiguous complete sibling groups when parallel tool calling is enabled. The task path uses capacity four. Nodes receive sequence identity, dependency readiness, individual outcomes, and a scheduler-owned abort signal. Task abort waits for the active batch promise.

## Alternatives and tradeoffs

Unbounded `Promise.all` risks host and subprocess starvation. A global queue would broaden contention. Sequential execution is safe but measurably slower. Bounded task scope gives overlap without detached work.

## Consequences and future considerations

Independent read workloads overlap. All classified mutations remain ordered through the current task-wide mutation claim. Cancellation of active backend work is cooperative. Any new lane needs a resource limit and cancellation test.
