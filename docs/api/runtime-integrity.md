# Runtime Integrity

`RuntimeIntegrityVerifier` protects operational truth in `RuntimeStateGraph`.

## Diagnostic IDs

| ID | Condition |
| --- | --- |
| RTG-001 | Node not linked to session |
| RTG-002 | Edge references missing node |
| RTG-003 | Execution without plan, or plan without audit |
| RTG-004 | Replay hash diverges from live graph |
| RTG-005 | Snapshot hash or CAS blob corruption |
| RTG-006 | Rollback missing `rolled_back_by` link |
| RTG-007 | Verification not linked to execution |
| RTG-008 | Session complete with open blockers/failures |

## Usage

Integrity is checked:

- Before `ctx.runtime.snapshot(sessionId)`
- After `ctx.runtime.verify()`
- During `ctx.runtime.replay(..., { mode: 'verification' })`
- Via `ctx.runtime.getMemoryHealth()`

## Report Shape

```typescript
interface IntegrityReport {
  healthy: boolean;
  violations: IntegrityViolation[];
  checkedAt: number;
}
```

## No Silent Corruption

Any RTG violation surfaces in:

- `getMemoryHealth().graphIntegrity` (`degraded` / `corrupted`)
- Snapshot rejection
- Replay `divergenceDetected` flag

## Forbidden

- Marking sessions complete with RTG-008 violations
- Ignoring integrity failures during snapshot
- Mutable replay that hides divergence
