# MEOW-007: Asynchronous Audit Persistence

**Status:** Accepted  
**Implementation:** `src/shared/audit/completionAudit.ts`, `TaskState.ts`

## Context and problem

Completion-audit durability and roadmap finalization occurred near the response path even when their settlement could not change the completion decision. Other audit-artifact and checkpoint writes have different contracts.

## Decision

Schedule pending completion-audit persistence after completion-result presentation and schedule roadmap finalization later in the completion branch. Retain latency events for scheduled settlement. Do not generalize this decision to optional workspace audit artifacts, completion-message persistence, or checkpoint saving, which remain awaited.

## Alternatives and tradeoffs

Synchronous persistence gives an immediate receipt but increases tail latency and couples availability to storage. Dropping evidence is unacceptable. Deferred persistence preserves evidence intent without blocking the response.

## Consequences and future considerations

Scheduled persistence remains attributable through task ID and latency scope, but the current best-effort scheduler does not implement a durable retry queue. A future change should not describe persistence as durable until that guarantee exists.
