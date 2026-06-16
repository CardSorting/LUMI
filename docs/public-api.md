# Public API (v30 frozen)

The npm package `@noorm/broccolidb` exports **only** what is listed in `broccolidb/core/public-api.ts`. Everything else is internal.

## Stable surface

### AgentContext lifecycle

- `new AgentContext(workspace, db?, userId?)`
- `await ctx.start()`
- `await ctx.stop()`
- `await ctx.flush()`
- `await ctx.health({ deep? })`

### Capabilities (getters on AgentContext)

| Getter | Purpose |
|--------|---------|
| `ctx.query` | Knowledge search, structural impact |
| `ctx.graph` | Graph traversal; **Spider** at `ctx.graph.spider` |
| `ctx.runtime` | Sessions, plans, execution, verification, state views |
| `ctx.audit` | Invariants |
| `ctx.storage` | Blob storage |
| `ctx.snapshots` | Context snapshots |
| `ctx.recovery` | Recovery operations |
| `ctx.telemetry` | Telemetry |
| `ctx.coordination` | Mutex / coordination |
| `ctx.reasoning` | Reasoning chains |
| `ctx.tasks` | Task board |
| `ctx.scratchpad` | Scratchpad |
| `ctx.mailbox` | Agent mailbox |

### Runtime operator API (`ctx.runtime`)

- `await beginSession(input)`
- `planRepairs`, `preview`, `execute`, `verify`
- `state(sessionId)`, `timeline`, `explain`, `nextActions`, `blockers`
- `await snapshot(sessionId)`, `story(sessionId)`, `await replay(sessionId, opts)`
- `getRuntimeHealth()`, `getMemoryHealth()`
- `setMode(mode)`, `export(sessionId, opts)`

### Spider (via graph only)

- `ctx.graph.spider.audit`, `.gate`, `.check`, `.formatCheckDigest`
- Never mutate files during audit; repairs go through `ctx.runtime.execute`

### Health

- `await ctx.health()` — lifecycle + capability health
- `ctx.runtime.getMemoryHealth()` — graph integrity, snapshots

### Errors

All public errors extend `AgentGitError` with a `code`. Lifecycle misuse uses `GuidedError` / `LifecycleStateError`. See [errors.md](errors.md).

## Classifications

| Label | Meaning |
|-------|---------|
| **STABLE** | In `public-api.ts`; semver applies |
| **INTERNAL** | `broccolidb/core/**` not re-exported |
| **DEPRECATED_FOR_REMOVAL** | Documented in MIGRATION.md only |
| **FORBIDDEN** | Direct service access, bypassing capabilities |

Details: [API_STABILITY.md](../broccolidb/API_STABILITY.md).
