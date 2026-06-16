# Runtime Events

The `RuntimeEventBus` provides typed, observational events for telemetry, CI streaming, and future UI integrations.

## Event Types

```typescript
type RuntimeEvent =
  | SessionStarted
  | AuditCompleted
  | GateBlocked
  | PlanGenerated
  | ExecutionStarted
  | ExecutionSucceeded
  | ExecutionFailed
  | VerificationSucceeded
  | VerificationFailed
  | RollbackStarted
  | RollbackCompleted
  | BudgetExceeded
  | PolicyViolation;
```

Each event includes `sessionId` and `timestamp`. Kinds are discriminated by `kind`.

## Accessing Events

```typescript
const events = ctx.runtime.getRuntimeEvents(session.sessionId);
const health = ctx.runtime.getRuntimeHealth();
const critical = health.recentCriticalEvents;
```

## Subscription (Internal)

```typescript
const unsubscribe = eventBus.subscribe((event) => {
  // Observational only — no side effects
});
```

## Critical Events

`getRecentCritical()` returns the latest events of kinds:

- `ExecutionFailed`
- `VerificationFailed`
- `BudgetExceeded`
- `PolicyViolation`
- `RollbackCompleted`

These feed `RuntimeHealth.recentCriticalEvents` and influence health status (`degraded` / `critical`).

## Doctrine

Events are **observational only**. Handlers must not trigger mutations, retries, or scheduling side effects. All consequential actions flow through `RuntimeScheduler` and `OrchestrationRuntime` methods.

## Journal Correlation

Every significant event has a corresponding `SessionJournalEntry` for replay reconstruction. Events are ephemeral (ring buffer); journal entries persist for session lifetime.
