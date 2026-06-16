# Query Capability

## Purpose
Knowledge search, verification, centrality, shared memory, tool execution, and agent bundles.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `search` | `QuerySearchInput` | `QuerySearchResult` |
| `verifyBatch` | `QueryVerifyBatchInput` | `QueryVerifyBatchResult` |
| `getGlobalCentrality` | `QueryGlobalCentralityInput` | `QueryGlobalCentralityResult` |
| `appendSharedMemory` | `QueryAppendSharedMemoryInput` | `QueryAppendSharedMemoryResult` |
| `decayConfidence` | `QueryDecayConfidenceInput` | `QueryDecayConfidenceResult` |
| `getAgentBundle` | `QueryAgentBundleInput` | `QueryAgentBundleResult` |
| `getTaskById` | `QueryTaskLookupInput` | `QueryTaskLookupResult` |
| `executeTools` | `QueryExecuteToolsInput` | `QueryExecuteToolsResult` |
| `reembedAll` | — | `QueryReembedResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `BackpressureError` / `FlushTimeoutError` — substrate pressure
- `AgentGitError` (`INVALID_ARGUMENT`)

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
const results = await ctx.query.search({ text: 'auth flow', limit: 10 });
```
