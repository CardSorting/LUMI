# Scratchpad Capability

## Purpose
Filesystem-backed scratch files for ephemeral agent working state.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `write` | `ScratchpadWriteInput` | `ScratchpadWriteResult` |
| `read` | `ScratchpadReadInput` | `ScratchpadReadResult` |
| `list` | — | `ScratchpadListResult` |
| `clear` | — | `ScratchpadClearResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `AgentGitError` (`INVALID_ARGUMENT`) — empty filename or content

## Lifecycle
Requires `await ctx.start()`. All filesystem access is delegated to `ScratchpadService`.

## Example
```ts
await ctx.scratchpad.write({ filename: 'notes.md', content: '# Plan' });
const { files } = await ctx.scratchpad.list();
```
