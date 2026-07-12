# HTE-005: Invocation-Local Presentation Context

**Status:** Accepted  
**Implementation:** `src/core/task/tools/siblings/ToolInvocationContext.ts`, `ToolExecutor.ts`

## Context and problem

A shared current-tool/presentation slot allowed one sibling's updates to contend with or overwrite another's evidence.

## Decision

Capture result content and cancellation context for scheduled children. Capture presentation events for workspace-local queries. Replay captured events and append result content in model-emission order after execution.

## Alternatives and tradeoffs

Keeping one mutable slot preserves old UI assumptions but serializes execution. Immediate completion-order rendering is fast but unstable. Local capture plus projection preserves both concurrency and predictability.

## Consequences and future considerations

A failure replaying captured query presentation does not erase captured result content. Interactive and non-query tools still use shared presentation state; future UI work should narrow that scope rather than assume it has already been removed.
