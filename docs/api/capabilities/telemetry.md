# Telemetry Capability

## Purpose
Records token usage and agent activity into the central telemetry substrate.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `record` | `TelemetryRecordInput` | `TelemetryRecordResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `AgentGitError` (`INVALID_ARGUMENT`) — missing usage fields

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
await ctx.telemetry.record({
  usage: { promptTokens: 10, completionTokens: 20 },
  agentId: 'agent-1',
});
```
