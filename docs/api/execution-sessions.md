# Execution Sessions

Execution sessions are the unit of orchestration in BroccoliDB v26. Every repair flow, audit linkage, and verification run is scoped to a session.

## Model

```typescript
type ExecutionSession = {
  sessionId: string;
  startedAt: number;
  agentId?: string;
  taskId?: string;
  correlationId?: string;

  intents: CapabilityIntent[];
  audits: SpiderReport[];
  repairPlans: MutationPlan[];
  executions: RepairExecution[];
  verifications: VerificationResult[];

  status:
    | 'running'
    | 'blocked'
    | 'awaiting_approval'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'rolled_back';

  failureReason?: string;
};
```

## Lifecycle

| Status | Meaning |
| --- | --- |
| `running` | Session active, no terminal outcome yet |
| `awaiting_approval` | Plan created, policy requires human sign-off |
| `verifying` | Mutation applied, verification in progress |
| `completed` | Execution + verification succeeded |
| `failed` | Execution or verification failed without rollback |
| `rolled_back` | Failure triggered snapshot restore |
| `blocked` | Reserved for policy-blocked states |

## API

### `ctx.runtime.beginSession(input?)`

Creates a session and emits `session_started` trace.

```typescript
const session = ctx.runtime.beginSession({
  taskId: 'repair-auth-flow',
  agentId: 'agent-42',
  correlationId: 'corr-abc',
});
```

Requires `ctx.start()` — orchestration runtime must be lifecycle-started.

### `ctx.runtime.recordAudit(sessionId, audit)`

Links a Spider audit report to the session. Emits `audit_recorded`.

### `ctx.runtime.recordIntent(sessionId, intent)`

Links a `CapabilityIntent` to the session for cross-capability correlation.

### `ctx.runtime.getSession(sessionId)`

Returns the live session snapshot or `undefined`.

### `ctx.runtime.getTrace(sessionId?)`

Returns execution trace events, optionally filtered by session.

## Correlation

Pass `sessionId` into capability operations via intent metadata where supported. Spider audits recorded on the session provide the verification baseline for subsequent `verify()` calls.

## Health

Session aggregates feed `RuntimeHealth.activeSessions` and `failedSessions`. Deep health is available via `ctx.health({ deep: true })` which includes lifecycle registry orchestration service health.
