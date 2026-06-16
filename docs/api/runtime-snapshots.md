# Runtime Snapshots

Runtime snapshots are immutable, versioned, content-addressed captures of `RuntimeStateGraph` state.

## Shape

```typescript
type RuntimeSnapshot = {
  snapshotId: string;
  sessionId?: string;
  createdAt: number;
  runtimeVersion: string;
  graphHash: string;
  nodeCount: number;
  edgeCount: number;
  mode: RuntimeMode;
  compressed: boolean;
  rootNodes: string[];
  blobHash: string;
  metadata?: Record<string, unknown>;
};
```

## Creating Snapshots

```typescript
const snapshot = await ctx.runtime.snapshot(sessionId);
```

Snapshots require passing `RuntimeIntegrityVerifier` checks — corrupted graphs cannot be snapshotted.

## Persistence

1. Graph serialized via `RuntimeGraphSerializer` → SHA-256 `graphHash`
2. Payload stored in CAS via `StorageService.writeBlob`
3. Metadata recorded via `BufferedDbPool.push` to `audit_events`

## Recovery

On `ctx.runtime` / `RuntimeGraphStore.start()`, snapshot metadata is recovered from `audit_events`. Graph payloads are loaded from CAS by `blobHash`.

## Compaction

`RuntimeCompactor` archives full graph state into a compressed snapshot and adds a `HealthSnapshot` summary node. Compacted sessions remain replayable from the archived snapshot.

## Forbidden

- Snapshot mutation after creation
- Persistence outside `RuntimeGraphStore`
- Implicit background snapshot timers
