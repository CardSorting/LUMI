# Runtime Modes

Runtime modes define the operational envelope for agent execution.

## Setting Mode

```typescript
await ctx.start();
ctx.runtime.setMode('production');
```

Mode is applied globally to the orchestration runtime. Sessions record the mode at creation time in `session.runtimeMode`.

## Mode Reference

### `development`

- Relaxed budgets (120s, 20 files, 30 directives)
- All directive types allowed
- Up to 2 concurrent executions
- Default policy: `autonomous_safe`

### `ci`

- Tighter budgets (60s, 10 files, 15 directives)
- Safe directives only (`UPDATE_IMPORT_PATH`, `REMOVE_STALE_IMPORT`, `RESYNC_DISK_PARITY`, `REFRESH_GRAPH_NODE`)
- Single concurrent execution
- Default policy: `ci_gate_only`
- Strict verification

### `production`

- Strict budgets (30s, 5 files, 10 directives)
- Safe directives only
- Single concurrent execution
- Default policy: `human_approval_required`
- Zero verification failures allowed by default budget

### `readonly`

- No mutations (`maxFilesTouched: 0`, `maxDirectives: 0`)
- Zero concurrent executions
- Audits and replay only

### `recovery`

- Extended budgets for recovery operations
- All directive types allowed
- Default policy: `recovery_mode`

### `forensic`

- Read-only investigation mode
- Replay and journal inspection
- No mutations, no concurrency

## Policy Derivation

When `execute()` is called without an explicit `policy`, the runtime uses the mode's default policy from `MODE_CONFIGS`.

## Mode Transitions

`setMode()` requires lifecycle-started runtime. Changing mode updates concurrency governor caps immediately. In-flight sessions retain their creation-time `runtimeMode` for budget resolution.
