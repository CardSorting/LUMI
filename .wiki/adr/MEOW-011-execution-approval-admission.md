# MEOW-011: Approval Is Execution Admission

Status: Accepted  
Date: 2026-07-18

## Context

Approval had several competing owners. `autoApprove.ts` could record approval without consulting settings, handlers inspected settings and prompted independently, `ToolExecutor` carried approval callbacks, the coordinator owned a dispatch wrapper, and composite handlers could invoke other handlers directly. The result was not reconstructable as one causal transaction: a decision, permit, and dispatch could come from different paths.

## Decision

`src/core/task/tools/execution/ExecutionFunnel.ts` is the sole approval and execution-admission authority. Approval is not a handler concern and is not a separate funnel.

The ordered transaction is:

1. Register the invocation under its task generation and invocation ID.
2. Normalize the proposed operation.
3. Obtain the handler's synchronous, pure `ApprovalIntent`.
4. Evaluate mode, lane, cancellation, fencing, roadmap, hook, and execution policy.
5. Snapshot and evaluate approval settings, trusted-command policy, command safety, and MCP per-tool policy.
6. Prompt only when the complete intent is not automatically admitted.
7. Record exactly one immutable `ApprovalDecision` linked to the intent, generation, and invocation.
8. Issue one invocation-scoped permit linked to that decision.
9. Dispatch through the funnel's permit-validating adapter.
10. Apply reliability, post-policy behavior, terminal classification, and immutable publication.

No absent, stale, malformed, or compatibility-shaped decision is converted into approval. A resumed task receives a new execution generation. Replays in the same generation are rejected, and asynchronous work loses authority as soon as its generation becomes stale.

Handlers must implement `getApprovalIntent(block)` without reading settings or runtime services. The intent declares normalized arguments, capabilities, paths/scopes, risks, side effects, prompt projection, and automatic-approval eligibility; it never contains a decision or permit. Missing or malformed intents fail closed before dispatch.

Composite operations use the same parent decision and permit only when every delegated pure intent is covered by the recorded parent intent. The funnel validates and audits that coverage before each delegated adapter call. Unknown commands cannot be discovered and executed after approval; an exact command must be declared before admission.

## Removed authorities

- `autoApprove.ts`: deleted; its unconditional approval behavior is intentionally removed.
- `ToolExecutor` approval callbacks and settings interpretation: removed; it passes the registered handler to the funnel and projects the outcome.
- `ToolExecutorCoordinator.execute`: removed; the coordinator is a registry only.
- Handler-local automatic approval, explicit approval prompts, approval hooks, and decision recording: removed. Handlers now return only pure intents for consent.
- `ToolResultUtils` approval helper and subagent approval shortcuts: removed.
- Reliability approval recording and public compatibility decision methods: removed. Reliability accepts only an active approval-linked permit.
- Legacy global `enabled`, favorites, and request-limit auto-approval fields: removed from the modern settings contract; residual persisted fields have no authority.
- Legacy `didRejectTool`, `didAlreadyUseTool`, and `autoApproveAllToggled` compatibility state: deleted. Turn control is projected only from the current-generation event.
- Handler-local notifications coupled to approval settings: removed. Handlers cannot read approval settings; UI notification remains a funnel projection concern.

## Audit contract

`ExecutionFunnelEvent` schema version 2 contains the frozen intent, evaluated policy inputs, prompt fact, one decision, decision actor/mechanism, permit-to-decision link, task generation, invocation, and ordered stages. Consumers select a whole event and never reinterpret it. UI is projection only.

Tool execution success remains distinct from task completion. Only `CompletionFunnel` may complete a task.

## Consequences

- Parent, sibling, and subagent transports share identical approval semantics.
- Disabling an approval action now causes a prompt; it no longer falls through an unconditional automatic approval.
- Durable internal-state mutations without an automatic-approval setting require explicit consent.
- Composite tools must declare their entire possible side-effect envelope up front or split work into another invocation.
- Conditional mutation paths used for governed-lane collision admission are derived from the frozen intent inside the funnel, not a competing static handler classifier.
- Tests may exercise handler logic with a deliberately stubbed delegated dispatcher, but production handler dispatch always requires the funnel's active causal permit.
