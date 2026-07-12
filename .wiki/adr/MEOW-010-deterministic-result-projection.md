# HTE-010: Deterministic Result Projection

**Status:** Accepted  
**Implementation:** `src/core/task/index.ts`, `ToolInvocationContext.ts`

## Context and problem

Completion-order UI updates coupled presentation to execution order and made concurrent results unstable.

## Decision

Assign each scheduled invocation a model-emission sequence number. Allow execution completion out of order, then iterate scheduler envelopes in sequence order, replay captured query presentation, and append result content.

## Alternatives and tradeoffs

Forcing execution order preserves output but forfeits overlap. Completion-order final rendering reduces latency but changes conversational semantics. Projection adds a small aggregation step while preserving stable output.

## Consequences and future considerations

Result envelopes remain attributable but are ordinary objects rather than runtime-enforced immutable values. A new presentation surface may choose completion-order progress only if final batch output remains deterministic.
