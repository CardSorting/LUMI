# Runtime Operator Views

Operator views compress runtime complexity into actionable surfaces. All views derive from `RuntimeStateGraph` via `RuntimeOperator`.

## 1. Timeline View

`ctx.runtime.timeline(sessionId)`

Ordered events: session start → intents → audits → findings → plans → approvals → executions → verifications → rollbacks.

Use for: debugging, CI logs, incident reconstruction.

## 2. Blocker View

`ctx.runtime.blockers(sessionId)`

Shows what stops progress:

| Blocker kind | Typical cause |
| --- | --- |
| `finding` | ERROR-severity Spider finding |
| `gate` | Gate exit code ≠ 0 |
| `policy` | Runtime policy violation |
| `budget` | Budget exceeded |
| `approval` | Awaiting human sign-off |
| `verification` | Post-mutation verification failed |

Each blocker includes `nextAction` with concrete command or API.

## 3. Causal View

`ctx.runtime.causalView(sessionId)`

Traces failure chains:

```text
Failure → Evidence (findings) → Directive → Plan → Execution → Verification → Rollback
```

Use for: root cause analysis, agent explanation, postmortems.

## 4. Diff View

`ctx.runtime.diffView(sessionId)`

- `introduced` — new findings after mutation
- `resolved` — findings cleared
- `remaining` — still open
- `diff` — `SpiderReportDiff` when available

## 5. Health View

`ctx.runtime.state(sessionId).summary` + `ctx.runtime.getRuntimeHealth()`

Combines session graph summary with substrate runtime health (concurrency, budget violations, policy violations, critical events).

## 6. Next Action View

`ctx.runtime.nextActions(sessionId)`

When blocked, surfaces:

- Finding + evidence reference
- Applicable repair directive
- Allowed policy modes
- Verification command
- Whether human approval is required

Example flow:

```typescript
const state = ctx.runtime.state(sessionId);
if (!state.success) {
  for (const action of ctx.runtime.nextActions(sessionId)) {
    console.log(action.label, action.command ?? action.api);
  }
}
```

## Export formats

| Format | Use |
| --- | --- |
| `json` | Programmatic consumption, CI artifacts |
| `markdown` | Human review, PR comments |
| `sarif` | Static analysis tooling, GitHub code scanning |

```typescript
ctx.runtime.export(sessionId, { format: 'sarif' });
```

## Open loops

`ctx.runtime.openLoops()` — cross-session view of unresolved operational state.

## Doctrine

No report may be assembled from ad hoc arrays when `RuntimeStateGraph` contains the source. Operator views are projections of the graph, not parallel truths.
