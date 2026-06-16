# Runtime Replay (v29)

v29 replay hydrates operational memory from durable snapshots with explicit modes.

## API

```typescript
const replay = await ctx.runtime.replay(sessionId, {
  mode: 'forensic',
  snapshotId: 'optional-specific-snapshot',
});
```

## Replay Modes

| Mode | Projection |
| --- | --- |
| `forensic` | Full readonly graph + integrity report |
| `timeline` | Nodes/edges sorted by timestamp |
| `causal` | Failures, plans, executions |
| `verification` | Verifications and findings |
| `ci` | Hash, counts, integrity summary |

## Guarantees

1. **Never mutates disk**
2. **Never enqueues execution**
3. **Never bypasses policy**
4. Detects **replay divergence** (RTG-004) when live graph hash differs from snapshot

## Hydration Flow

```text
snapshotId? → RuntimeSnapshotStore.load
           → RuntimeMigrationEngine.migrate
           → RuntimeGraphSerializer.deserialize (hash verify)
           → RuntimeIntegrityVerifier.verify
           → readonly ReplayHydrationResult
```

## Return Type

```typescript
interface ReplayHydrationResult {
  sessionId: string;
  mode: ReplayMode;
  readonly: true;
  snapshot?: RuntimeSnapshot;
  graph: SerializedRuntimeGraph;
  integrity: IntegrityReport;
  divergenceDetected: boolean;
}
```

## Forbidden

- Graph mutation during replay
- Replay-triggered execution
- Reconstruction from ad hoc session arrays when snapshots exist
