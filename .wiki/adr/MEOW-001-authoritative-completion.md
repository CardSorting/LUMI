# MEOW-001: Authoritative Completion

**Status:** Accepted  
**Implementation:** `src/core/task/tools/handlers/AttemptCompletionHandler.ts`, `completionGatePipeline.ts`

## Context and problem

Completion was vulnerable to multiple layers rechecking lifecycle, diagnostics, and persistence state. A valid result could be delayed or overturned by a procedural concern that could not change validity.

## Decision

`AttemptCompletionHandler` evaluates one canonical lifecycle snapshot and action guard per completion attempt. After the guard allows completion, it still awaits advisory preflight/audit evaluation and optional workspace-artifact persistence before latching the authoritative result. It then presents the result, schedules pending completion-audit persistence, and awaits message/checkpoint follow-up work. Roadmap finalization is scheduled later.

## Alternatives and tradeoffs

Competing lifecycle decisions were rejected as a second source of truth. The implementation has one binding lifecycle/action-guard decision, but “one decision” does not mean the entire completion handler is one pass or fully asynchronous.

## Consequences and future considerations

Failure of scheduled completion-audit persistence or roadmap finalization does not alter the latched decision. Pre-result audit evaluation and synchronous workspace artifacts are separate mechanisms. Any future binding completion rule belongs in the lifecycle decision and requires a focused test.
