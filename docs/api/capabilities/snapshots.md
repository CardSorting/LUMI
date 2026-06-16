# Snapshots Capability

## Purpose
Persist point-in-time health snapshots as content-addressed blobs via `StorageService`.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `create` | `SnapshotCreateInput` | `SnapshotCreateResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `StorageIntegrityError` — store failures

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
const { hash } = await ctx.snapshots.create({ metadata: { label: 'pre-migration' } });
```
