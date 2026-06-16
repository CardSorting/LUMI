# BroccoliDB v27: Runtime Governance

v27 evolves the v26 orchestration pipeline into a **governed operational runtime** that constrains, budgets, schedules, and replays agent execution under explicit policy.

## Thesis

BroccoliDB is not an autonomous repair bot. It is a governed orchestration substrate where agents operate inside runtime sovereignty.

## Governance Stack

```text
ExecutionSession
  → SessionQueue (FIFO + priority)
  → RuntimePolicyEngine
  → ExecutionBudgetManager
  → ConcurrencyGovernor
  → RuntimeScheduler
  → RepairExecutor
  → VerificationPipeline
  → RollbackCoordinator
  → SessionJournal + RuntimeEventBus
  → ReplayRecorder
```

## Runtime Modes

| Mode | Mutation | Default policy | Concurrency |
| --- | --- | --- | --- |
| `development` | All directives | `autonomous_safe` | 2 |
| `ci` | Safe directives only | `ci_gate_only` | 1 |
| `production` | Safe directives only | `human_approval_required` | 1 |
| `readonly` | None | `readonly` | 0 |
| `recovery` | All directives | `recovery_mode` | 1 |
| `forensic` | None (replay only) | `readonly` | 0 |

```typescript
ctx.runtime.setMode('ci');
```

Mode governs allowed directives, budgets, concurrency caps, verification strictness, and telemetry durability.

## Execution Budgets

Per-session budgets merge with mode defaults:

```typescript
const session = await ctx.runtime.beginSession({
  taskId: 'repair-auth-flow',
  budget: {
    maxDurationMs: 30_000,
    maxFilesTouched: 5,
    maxDirectives: 10,
  },
});
```

Budget exceeded → `RuntimeBudgetExceededError` → rollback if snapshots exist.

## Scheduling

All `execute()` calls route through `RuntimeScheduler`:

1. Enqueue (priority-aware FIFO)
2. Policy check
3. Budget check
4. Concurrency acquire
5. Execute
6. Verify
7. Commit or rollback

No scheduler bypass. No hidden parallel mutations.

## Session Journaling & Replay

Every operational event is journaled. `ctx.runtime.replay(sessionId)` reconstructs session state in **readonly forensic mode** — never mutates disk.

## Observability

`RuntimeEventBus` emits typed events (`SessionStarted`, `BudgetExceeded`, `PolicyViolation`, etc.). Events are observational only — no side effects in handlers.

Expanded `getRuntimeHealth()` includes concurrency utilization, budget/policy violations, runtime mode, and recent critical events.

## Forbidden Patterns

- Hidden retries
- Uncontrolled parallel mutations
- Scheduler bypass
- Mutable replay
- Implicit runtime mode
- Background mutation daemons
- Recursive self-healing loops

## Doctrine

Nothing mutates without governance.  
Nothing executes without budget.  
Nothing bypasses verification.  
Nothing escapes replayability.  
Nothing outruns lifecycle ownership.
