# Getting started

## Install

```bash
npm install @noorm/broccolidb
npx broccolidb init
```

## Required lifecycle

Every script, test, and agent integration **must** follow this pattern:

```typescript
import { AgentContext, Workspace, Connection } from '@noorm/broccolidb';

const ctx = new AgentContext(workspace, pool, userId);
await ctx.start();
try {
  // use ctx.query, ctx.graph, ctx.runtime, ...
} finally {
  await ctx.stop();
}
```

Calling capabilities before `start()` throws `LIFECYCLE_STATE_ERROR` with an actionable message. See [errors.md](errors.md).

## Capabilities (not raw services)

| Need | Use |
|------|-----|
| Search / impact | `ctx.query` |
| Structural audit / gate | `ctx.graph.spider` |
| Repairs / verification | `ctx.runtime` |
| Health | `await ctx.health()` |
| Snapshots / replay / story | `ctx.runtime.snapshot`, `.replay`, `.story` |

**Do not** import `SpiderService` or other internal services on `AgentContext`.

## CLI quick check

```bash
npx broccolidb health --format json
npx broccolidb spider gate
```

See [cli.md](cli.md).

## Examples

Runnable golden paths: [examples.md](examples.md).
