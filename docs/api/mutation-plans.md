# Mutation Plans

Mutation plans bridge Spider forensic output and disciplined repair execution. Spider emits `RepairDirective`; `MutationPlanner` converts directives into an executable, approvable plan.

## Spider Never Mutates

Spider produces:

- findings
- evidence
- repair directives

`MutationPlanner` produces `MutationPlan`. Only `RepairExecutor` applies disk changes.

## MutationPlan Shape

```typescript
interface MutationPlan {
  planId: string;
  sessionId: string;
  correlationId?: string;
  createdAt: number;
  steps: MutationStep[];
  estimatedRisk: 'low' | 'medium' | 'high';
  affectedFiles: string[];
  rollbackStrategy: RollbackStrategy;
  requiredVerificationCommands: string[];
  requiredApprovals: ApprovalPolicy[];
  expectedInvariantChanges: string[];
  sourceReportId: string;
  directives: RepairDirective[];
}
```

Each `MutationStep` maps 1:1 to a `RepairDirective` with ordered execution metadata.

## Planning

```typescript
const plan = ctx.runtime.planRepairs({
  audit,
  policy: 'autonomous_safe',
  sessionId: session.sessionId,
});
```

Risk aggregation:

- `low` → `autonomous_safe` may proceed
- `medium` → requires `ci_gate_only`
- `high` → requires `human_approval_required`

## Preview

```typescript
const preview = ctx.runtime.preview(plan, 'human_approval_required');
console.log(preview.narrative);
console.log(preview.policyDecision);
```

Preview is read-only — no mutation, no approval side effects.

## Execution

```typescript
const { execution, session } = await ctx.runtime.execute({
  plan,
  policy: 'human_approval_required',
  approvedBy: 'operator@team',
});
```

Before execution:

1. `ApprovalPolicyEngine.assertAllowed(plan, policy, approvedBy?)`
2. `RollbackCoordinator.snapshotBefore(affectedFiles)`
3. `RepairExecutor.execute(plan)` — sole mutation path

On execution failure, snapshots are restored automatically.

## Supported Auto-Execute Directives

| Type | Executor behavior |
| --- | --- |
| `RESYNC_DISK_PARITY` | Delegates to `spider.resync` |
| `REFRESH_GRAPH_NODE` | Delegates to `spider.resync` |
| `UPDATE_IMPORT_PATH` | Rewrites import specifier |
| `REMOVE_STALE_IMPORT` | Removes stale import line |
| `ADD_MISSING_EXPORT` | Prepends export |
| `RENAME_SYMBOL_REFERENCE` | In-file replace |
| `MOVE_SYMBOL_REFERENCE` | In-file replace |
| `BREAK_CYCLE_BY_INTERFACE` | **Blocked** — human refactor required |
| `FIX_LAYER_VIOLATION` | **Blocked** — human refactor required |

## Rollback Strategy

Every plan with file mutations uses `file-snapshot` rollback:

- Snapshots captured before execution
- Restored on execution failure or verification failure
- Discarded on successful verification

No partial unknown state.
