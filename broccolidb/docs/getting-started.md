# Getting started

## Install

```bash
npm install @noorm/broccolidb
npx broccolidb init
```

`init` creates `broccolidb.db`, indexes your Git repository, and optionally wires the MCP server into Claude Desktop.

## Required lifecycle

Every script, test, agent integration, and MCP handler **must** follow this pattern:

```typescript
import { AgentContext, Workspace, Connection } from '@noorm/broccolidb';

const conn = new Connection({ dbPath: './broccolidb.db' });
const pool = conn.getPool();
await pool.start();

const workspace = new Workspace(pool, userId, workspaceId);
workspace.setPhysicalPath(process.cwd());
await workspace.init();

const ctx = new AgentContext(workspace, pool, userId);
await ctx.start();

try {
  // capabilities and runtime only work here
} finally {
  await ctx.flush(); // optional: persist pending writes
  await ctx.stop();
}
```

Calling a capability before `start()` throws `GuidedError` / `LifecycleStateError` with an actionable message. See [errors.md](errors.md).

### Restart after `stop()`

`BufferedDbPool` cannot restart after `stop()`. To simulate a process restart, create a **new** pool on the same database path:

```typescript
await ctx1.stop();

const pool2 = new BufferedDbPool(); // same setDbPath / db file
await pool2.start();
const ctx2 = new AgentContext(workspace2, pool2, userId);
await ctx2.start();
// persisted runtime snapshots reload on ctx2.runtime.start()
```

See [examples/runtime-replay.ts](../examples/runtime-replay.ts).

## Use capabilities, not services

| Need | API | Do not use |
|------|-----|------------|
| Knowledge search | `ctx.query.search()` | `ServiceContext.searchKnowledge` |
| Structural impact | `ctx.graph.getStructuralImpact()` | raw `GraphService` |
| Spider audit / gate | `ctx.graph.spider` | `SpiderService` directly |
| Repairs & verification | `ctx.runtime` | ad-hoc file writes |
| Health | `await ctx.health()` | internal registry probes |
| Snapshots / replay / story | `ctx.runtime.snapshot`, `.replay`, `.story` | in-memory-only session state |

Spider **never mutates files during audit**. Repairs go through `ctx.runtime.execute`.

## Typical agent flow

```typescript
await ctx.start();
try {
  const session = await ctx.runtime.beginSession({ taskId: 'fix-imports' });

  const audit = await ctx.graph.spider.audit({
    scope: 'all',
    includeRepairDirectives: true,
  });
  ctx.runtime.recordAudit(session.sessionId, audit);

  const gate = await ctx.graph.spider.gate({ scope: 'all' });
  ctx.runtime.recordGate(session.sessionId, gate.exitCode, audit.reportId);

  if (gate.blocked) {
    const plan = ctx.runtime.planRepairs({
      audit,
      sessionId: session.sessionId,
      policy: 'human_approval_required',
    });
    const preview = ctx.runtime.preview(plan, 'human_approval_required');
    // human approves, then:
    // await ctx.runtime.execute({ plan, policy: 'human_approval_required' });
  }

  await ctx.runtime.snapshot(session.sessionId);
} finally {
  await ctx.stop();
}
```

## Runtime modes

Set before or during a session:

```typescript
ctx.runtime.setMode('development'); // local work; default policy autonomous_safe
ctx.runtime.setMode('ci');          // pipeline gates
ctx.runtime.setMode('production');  // human_approval_required
ctx.runtime.setMode('readonly');    // audit only
ctx.runtime.setMode('recovery');    // recovery_mode repairs
ctx.runtime.setMode('forensic');    // read-only investigation
```

Policies (`human_approval_required`, `autonomous_safe`, …) are passed to `planRepairs` / `execute` separately from mode.

## CLI smoke check

```bash
npx broccolidb health --format json
npx broccolidb spider gate
```

See [cli.md](cli.md).

## Next steps

- [Public API](public-api.md) — full stable surface
- [Examples](examples.md) — runnable scripts
- [Architecture](architecture/current.md) — system overview
