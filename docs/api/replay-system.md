# Replay System

The replay system reconstructs session execution history for debugging, CI artifacts, and forensic investigation.

## Replay API

```typescript
const replay = ctx.runtime.replay(session.sessionId);
```

Returns:

```typescript
interface ReplayResult {
  sessionId: string;
  mode: RuntimeMode;
  readonly: true;
  session: ExecutionSession;
  journal: SessionJournalEntry[];
  events: RuntimeEvent[];
  traces: Array<{ kind: string; timestamp: number; detail: Record<string, unknown> }>;
}
```

## Guarantees

1. **Never mutates disk** — replay operates on cloned session state
2. **Readonly forensic mode** — `readonly: true` is always set
3. **Deterministic reconstruction** — journal + events + traces reproduce operational timeline
4. **No execution side effects** — replay does not re-run repairs or verifications

## Session Journal

Journal entries recorded for:

| Kind | Trigger |
| --- | --- |
| `session_started` | `beginSession` |
| `audit` | `recordAudit` |
| `gate` | `recordGate` |
| `plan` | `planRepairs` |
| `approval` | Pre-execution policy grant |
| `execution` | Repair completion |
| `verification` | Post-mutation verify |
| `rollback` | Snapshot restore |
| `failure` | Execution failure |
| `completion` | Successful verification |
| `budget_exceeded` | Budget violation |
| `policy_violation` | Policy block |

```typescript
const journal = ctx.runtime.getJournal(sessionId);
```

## CI Artifacts

```typescript
import { ReplayRecorder } from '@noorm/broccolidb';
const recorder = new ReplayRecorder();
const artifact = recorder.toCiArtifact(replay);
// schema: broccolidb.runtime.replay/v1
```

## Forensic Mode

Set `ctx.runtime.setMode('forensic')` before sessions intended for investigation-only replay. Mutations are blocked; journaling and event emission continue.

## Forbidden

- Mutable replay (modifying live session from replay result)
- Replay-triggered re-execution
- Replay without lifecycle-started runtime
