# Recovery Capability

## Purpose
Warmup, retraction, GC, epistemic sunsetting, and memory synthesis for operational recovery.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `recover` | `RecoveryRecoverInput` | `RecoveryRecoverResult` |
| `retractLastOperation` | — | `RecoveryRetractResult` |
| `reconstituteFromDigest` | `RecoveryReconstituteInput` | `RecoveryReconstituteResult` |
| `performGarbageCollection` | — | `RecoveryGarbageCollectionResult` |
| `performEpistemicSunsetting` | `RecoveryEpistemicSunsettingInput` | `RecoveryEpistemicSunsettingResult` |
| `performMemorySynthesis` | — | `RecoveryMemorySynthesisResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `RecoveryError` — warmup failures during `recover`
- `AgentGitError` (`INVALID_ARGUMENT`) — unsupported recovery mode

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
const recovery = await ctx.recovery.recover({ mode: 'standard' });
```
