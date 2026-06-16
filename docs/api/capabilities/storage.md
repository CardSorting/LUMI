# Storage Capability

## Purpose
Content-addressed blob store for agent payloads. Routes through `StorageService` only.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `store` | `StorageStoreInput` | `StorageStoreResult` |
| `hydrate` | `StorageHydrateInput` | `StorageHydrateResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError` — before `start()` or after `stop()`
- `AgentGitError` (`INVALID_ARGUMENT`) — empty content or invalid hash
- `StorageIntegrityError` — blob hash mismatch on hydrate

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
await ctx.start();
const stored = await ctx.storage.store({ content, namespace: 'scratchpad' });
const payload = await ctx.storage.hydrate({ hash: stored.hash });
await ctx.stop();
```
