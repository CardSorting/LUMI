# BroccoliDB v29: Runtime Sovereignty Closure

v29 elevates RuntimeStateGraph from runtime coordination structure to **sovereign operational memory** — durable, replayable, recoverable, and integrity-verified across time.

## Thesis

If the graph is lost, operational truth is lost. If the graph drifts, runtime trust collapses.

RuntimeStateGraph is a first-class substrate concern.

## Architecture

```text
RuntimeStateGraph
  → RuntimeGraphSerializer (content-addressed)
  → RuntimeSnapshotStore (BufferedDbPool + StorageService CAS)
  → RuntimeReplayHydrator (readonly forensic modes)
  → RuntimeIntegrityVerifier (RTG-001..008)
  → RuntimeCompactor (non-destructive archival)
  → RuntimeMigrationEngine (explicit schema versions)
  → RuntimeIndex (cross-session queries)
  → RuntimeStoryBuilder (causal compression)
```

## Persistence Doctrine

- Graph payloads: `StorageService.writeBlob` (CAS)
- Snapshot metadata: `BufferedDbPool` → `audit_events` (`type: runtime_snapshot`)
- No sidecar graph databases
- No hidden snapshot timers — `snapshot()` and `flush()` are explicit

## RTG Diagnostics

| ID | Name |
| --- | --- |
| RTG-001 | OrphanedNode |
| RTG-002 | DanglingEdge |
| RTG-003 | InvalidExecutionChain |
| RTG-004 | ReplayDivergence |
| RTG-005 | SnapshotCorruption |
| RTG-006 | InvalidRollbackLink |
| RTG-007 | IncompleteVerification |
| RTG-008 | RuntimeTruthMismatch |

## Agent Flow

```typescript
const session = await ctx.runtime.beginSession({ taskId: 'repair-auth-flow' });
// ... audit, plan, execute, verify ...
const snapshot = await ctx.runtime.snapshot(session.sessionId);
const replay = await ctx.runtime.replay(session.sessionId, { mode: 'forensic' });
const story = ctx.runtime.story(session.sessionId);
const memory = ctx.runtime.getMemoryHealth();
```

## Doctrine

Nothing operational exists outside the graph.  
Nothing mutates without traceability.  
Nothing survives without verification.  
Nothing drifts without detection.  
Nothing escapes operational memory.
