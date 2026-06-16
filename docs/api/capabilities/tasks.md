# Tasks Capability

## Purpose
Agent registration, task spawning, memory layers, and sovereign scratchpad lifecycle.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `registerAgent` | `TaskRegisterAgentInput` | `TaskRegisterAgentResult` |
| `spawn` | `TaskSpawnInput` | `TaskSpawnResult` |
| `updateStatus` | `TaskUpdateStatusInput` | `TaskUpdateStatusResult` |
| `getContext` | `TaskContextInput` | `TaskContextResult` |
| `appendMemoryLayer` | `TaskAppendMemoryInput` | `TaskAppendMemoryResult` |
| `getScratchpadPath` | — | `TaskScratchpadPathResult` |
| `loadScratchpad` | — | `TaskScratchpadContentResult` |
| `updateScratchpad` | `TaskScratchpadContentInput` | `TaskScratchpadUpdateResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `AgentGitError` (`INVALID_ARGUMENT`)

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
await ctx.tasks.spawn({
  taskId: 'task-1',
  agentId: 'agent-1',
  description: 'Refactor auth module',
});
```
