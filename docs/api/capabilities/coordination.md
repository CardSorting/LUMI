# Coordination Capability

## Purpose
Teammate registry, distributed locks, and worker orchestration.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `registerTeammate` | `CoordinationRegisterTeammateInput` | `CoordinationRegisterTeammateResult` |
| `getTeammates` | — | `CoordinationTeammatesResult` |
| `acquireLock` | `CoordinationAcquireLockInput` | `CoordinationAcquireLockResult` |
| `releaseLock` | `CoordinationReleaseLockInput` | `CoordinationReleaseLockResult` |
| `spawnWorker` | `CoordinationSpawnWorkerInput` | `CoordinationSpawnWorkerResult` |
| `synthesizeWorkers` | `CoordinationSynthesizeWorkersInput` | `CoordinationSynthesizeWorkersResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `DatabaseLockError` — lock contention failures
- `AgentGitError` (`INVALID_ARGUMENT`)

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
const { acquired, token } = await ctx.coordination.acquireLock({ resource: 'build' });
```
