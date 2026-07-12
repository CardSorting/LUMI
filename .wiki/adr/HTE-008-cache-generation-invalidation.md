# HTE-008: Cache Generation Invalidation

**Status:** Accepted  
**Implementation:** `src/core/task/tools/io/IoRequestCoalescer.ts`, `ToolExecutor.ts`

## Context and problem

Concurrent reads and local mutations could otherwise allow a stale in-flight result to seed a post-mutation cache.

## Decision

Key supported parent-I/O requests by resolved target, task generation, tool name, and the result-affecting fields represented by the current key builder. Replace the task coalescer after qualifying local mutations or scratchpad reads that may create. Command execution does not currently reset this coalescer.

## Alternatives and tradeoffs

Clearing every cache globally is safe but expensive. Timestamp heuristics are ambiguous. Generation identity is narrow, deterministic, and testable.

## Consequences and future considerations

Existing callers may receive an old in-flight result, and that result may enter the old coalescer object. It cannot enter the replacement generation. New coalescing keys must include every field that changes the result.
