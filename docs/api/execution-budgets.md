# Execution Budgets

Execution budgets prevent runaway repair spirals and enforce deterministic failure.

## Budget Shape

```typescript
type ExecutionBudget = {
  maxDurationMs: number;
  maxFilesTouched: number;
  maxDirectives: number;
  maxConcurrentExecutions: number;
  maxVerificationFailures: number;
  maxRollbackAttempts: number;
};
```

## Session Budgets

Pass partial budgets at session creation — they merge with mode defaults:

```typescript
const session = await ctx.runtime.beginSession({
  taskId: 'repair-auth',
  budget: {
    maxDurationMs: 30_000,
    maxFilesTouched: 5,
    maxDirectives: 10,
  },
});
```

## Enforcement Points

| Check | When |
| --- | --- |
| `maxDurationMs` | Before execution (elapsed since `session.startedAt`) |
| `maxDirectives` | Before execution (plan step count) |
| `maxFilesTouched` | Before execution (cumulative + plan affected files) |
| `maxVerificationFailures` | Before execution (session counter) |
| `maxRollbackAttempts` | Before execution (session counter) |
| `maxConcurrentExecutions` | Via `ConcurrencyGovernor` at dispatch |

## Budget Exceeded

When a budget is exceeded:

1. `RuntimeBudgetExceededError` thrown (code: `BUDGET_EXCEEDED`)
2. `BudgetExceeded` event emitted
3. Journal entry `budget_exceeded` recorded
4. Rollback triggered if mutation snapshots exist
5. `budgetViolations` health metric incremented

## Mode Defaults

See `DEFAULT_BUDGETS` in `core/orchestration/runtime/types.ts` for per-mode defaults.

Production mode enforces `maxVerificationFailures: 0` — a single failed verification blocks further execution attempts within budget.

## Forbidden

- Infinite repair loops
- Budget bypass via direct `RepairExecutor` access
- Implicit budget expansion without explicit session override
