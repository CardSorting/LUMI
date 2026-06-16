# Runtime State API

The runtime state API provides canonical operational truth from `RuntimeStateGraph`.

## `ctx.runtime.state(sessionId)`

Returns `RuntimeSessionState`:

```typescript
{
  sessionId: string;
  status: ExecutionSessionStatus;
  runtimeMode: RuntimeMode;
  success: boolean;
  failureCause?: FailureCause;
  graph: RuntimeStateGraphSnapshot;
  summary: {
    intentCount, auditCount, findingCount,
    planCount, executionCount, verificationCount,
    rollbackCount, openBlockerCount
  };
}
```

`success` is computed from graph linkage — not raw session status.

## `ctx.runtime.timeline(sessionId)`

Ordered chronological view of all nodes and edges for the session.

## `ctx.runtime.explain(sessionId)`

Human-readable narrative plus `causalSummary` and `blockerCount`.

## `ctx.runtime.nextActions(sessionId)`

Concrete `RuntimeNextAction[]` with:

- `label` — what to do
- `command` — shell/agent command when applicable
- `api` — BroccoliDB API call
- `requiresHumanApproval`
- `allowedPolicies`

## `ctx.runtime.blockers(sessionId?)`

`RuntimeBlocker[]` with typed `cause`, `severity`, `message`, and embedded `nextAction`.

Omit `sessionId` to aggregate blockers across all sessions.

## `ctx.runtime.export(sessionId, { format })`

Formats: `json` | `markdown` | `sarif`

All exports assemble from graph-backed operator views.

## `ctx.runtime.openLoops()`

Sessions with unresolved operational loops: `awaiting_approval`, `verifying`, `blocked`, `running`.

## `ctx.runtime.causalView(sessionId)` / `ctx.runtime.diffView(sessionId)`

Causal chains (failure → evidence → plan → execution → verification) and introduced/resolved finding diffs.

## Recording linkage

Always record operations through runtime methods so graph linkage is maintained:

```typescript
const session = await ctx.runtime.beginSession({ taskId: '...' });
const audit = await ctx.graph.spider.audit({ scope: 'changed-files' });
ctx.runtime.recordAudit(session.sessionId, audit);
ctx.runtime.recordGate(session.sessionId, gate.exitCode, audit.reportId);
```

## Failure causes

`gate_blocked` · `execution_failed` · `verification_failed` · `budget_exceeded` · `policy_violation` · `rollback_failed` · `approval_required` · `open_blockers`
