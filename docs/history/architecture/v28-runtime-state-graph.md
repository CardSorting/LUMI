# BroccoliDB v28: Runtime State Graph

v28 collapses all runtime operational facts into one canonical **RuntimeStateGraph**. Every audit, plan, execution, verification, rollback, and failure is a node with typed edges — not a parallel array living beside another structure.

## Thesis

A governed runtime is world-class when any operator, agent, CI system, or future UI can answer instantly:

> What happened, why, what changed, what failed, what is blocked, and what should happen next?

## RuntimeStateGraph

### Nodes

`Intent` · `Session` · `Audit` · `Finding` · `RepairDirective` · `MutationPlan` · `ApprovalDecision` · `Execution` · `Verification` · `Rollback` · `Replay` · `RuntimeEvent` · `HealthSnapshot` · `BudgetViolation` · `PolicyViolation` · `Gate`

### Edges

`created` · `triggered` · `blocked_by` · `approved_by` · `executed_by` · `verified_by` · `rolled_back_by` · `introduced` · `resolved` · `failed_due_to` · `replayed_from` · `belongs_to_session`

### Linkage rules

1. Every audit belongs to a session
2. Every plan belongs to an audit (`triggered`)
3. Every execution belongs to a plan (`executed_by`)
4. Every verification belongs to an execution (`verified_by`)
5. Every rollback links to failed execution or verification (`rolled_back_by`)
6. Every runtime event links to session
7. Every failure has typed cause (`failed_due_to`)
8. Every blocked state has next action via `RuntimeOperator`

## Operator APIs

```typescript
const state = ctx.runtime.state(sessionId);
const next = ctx.runtime.nextActions(sessionId);
const blockers = ctx.runtime.blockers(sessionId);
const timeline = ctx.runtime.timeline(sessionId);
const explain = ctx.runtime.explain(sessionId);
const exported = ctx.runtime.export(sessionId, { format: 'json' });
const loops = ctx.runtime.openLoops();
```

All views are generated from `RuntimeStateGraph` — not ad hoc session arrays.

## Agent ergonomics

Instead of inspecting 8 disconnected objects:

```typescript
const state = ctx.runtime.state(sessionId);
if (!state.success) {
  const next = ctx.runtime.nextActions(sessionId);
  const blockers = ctx.runtime.blockers(sessionId);
}
```

## Completion guardrails

No session marked `completed` when:

- Open blockers remain
- Gate failed
- Verification failed
- Budget was exceeded
- Rollback failed

`state.success` is derived from graph truth, not session status alone.

## Doctrine

BroccoliDB does not merely execute agent work.  
BroccoliDB maintains the **operational truth** of agent work.

If it happened, it is in the graph.  
If it failed, the cause is typed.  
If it is blocked, the next action is explicit.  
If it succeeded, verification proves it.
