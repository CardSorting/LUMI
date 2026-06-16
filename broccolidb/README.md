# BroccoliDB

**A stable operational substrate for agent-driven code work.**

BroccoliDB gives agents a typed, lifecycle-governed environment: capabilities validate intent, the runtime governs execution, Spider proves structure, and durable snapshots preserve continuity across restarts.

> v30 freeze: no new architecture layers. The public API is frozen, documented, and tested. A complete system is boring to operate.

## Install

```bash
npm install @noorm/broccolidb
npx broccolidb init
```

## Quick start

```typescript
import { AgentContext, Workspace, Connection } from '@noorm/broccolidb';

const conn = new Connection({ dbPath: './broccolidb.db' });
const pool = conn.getPool();
await pool.start();

const workspace = new Workspace(pool, 'user-id', 'workspace-id');
workspace.setPhysicalPath(process.cwd());
await workspace.init();

const ctx = new AgentContext(workspace, pool, 'user-id');
await ctx.start();

try {
  const health = await ctx.health();
  const session = await ctx.runtime.beginSession({ taskId: 'my-task' });
  const audit = await ctx.graph.spider.audit({ scope: 'all' });
  ctx.runtime.recordAudit(session.sessionId, audit);
} finally {
  await ctx.stop();
}
```

**Required:** `await ctx.start()` before any capability. `await ctx.stop()` in `finally`. See [docs/getting-started.md](docs/getting-started.md).

## CLI

```bash
npx broccolidb health --format json
npx broccolidb spider gate
npx broccolidb spider compact
npx broccolidb runtime story <sessionId>
```

Full reference: [docs/cli.md](docs/cli.md).

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/getting-started.md](docs/getting-started.md) | Lifecycle, capabilities, first calls |
| [docs/public-api.md](docs/public-api.md) | Frozen stable API |
| [docs/errors.md](docs/errors.md) | Typed errors with fixes |
| [docs/cli.md](docs/cli.md) | CLI commands and output formats |
| [docs/examples.md](docs/examples.md) | Golden-path scripts |
| [docs/architecture/current.md](docs/architecture/current.md) | How the system fits together |
| [docs/papers/whitepaper.md](docs/papers/whitepaper.md) | Technical whitepaper |
| [docs/papers/companion-brief.md](docs/papers/companion-brief.md) | Executive companion brief |
| [docs/papers/philosophy.md](docs/papers/philosophy.md) | Philosophy & doctrine |
| [API_STABILITY.md](API_STABILITY.md) | Stable vs internal APIs |
| [MIGRATION.md](MIGRATION.md) | Upgrading to v30 |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Examples

```bash
cd broccolidb
npx tsx examples/basic-context.ts
npx tsx examples/spider-gate.ts
npm run test:examples
```

## Development

```bash
npm install
npm run build
npm run test:guardrails   # public API, docs links, CLI smoke
npm run test:smoke        # runtime recovery across restart
npm run test:examples     # golden-path scripts
```

Run the full test suite:

```bash
npm test
```

## Package layout

| Path | Role |
|------|------|
| `core/public-api.ts` | Frozen npm exports |
| `core/agent-context.ts` | `AgentContext` and capabilities |
| `core/orchestration/` | Runtime, state graph, durable store |
| `core/policy/spider/` | Spider engine (internal; access via `ctx.graph.spider`) |
| `cli/` | `broccolidb` command-line tool |
| `examples/` | Runnable golden paths |
| `tests/` | Unit, integration, and guardrail tests |

## Doctrine

Agents express intent. Capabilities validate intent. Runtime governs execution. Spider proves structure. StateGraph preserves truth. Snapshots preserve continuity. Replay reconstructs causality.

## License

MIT
