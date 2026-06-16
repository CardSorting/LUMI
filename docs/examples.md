# Examples

Golden-path scripts live in `broccolidb/examples/`. Each uses capabilities, calls `start()` / `stop()`, and prints expected output.

## Run

```bash
cd broccolidb
npx tsx examples/basic-context.ts
```

## Catalog

| Script | Demonstrates |
|--------|----------------|
| `basic-context.ts` | Lifecycle, `ctx.health()`, typed lifecycle error |
| `spider-gate.ts` | `ctx.graph.spider.audit` + `.gate` via runtime session |
| `repair-flow.ts` | Audit → plan → preview (no silent mutation) |
| `runtime-replay.ts` | Snapshot, restart, replay, story |
| `health-check.ts` | Deep health + memory integrity |
| `ci-gate.ts` | `spider.check` + `formatCheckDigest` for CI |

## Rules

- No raw `SpiderService` imports
- Always `await ctx.start()` before capabilities
- Always `await ctx.stop()` in `finally`
- Repairs only through `ctx.runtime.execute`

Smoke test: `npx tsx tests/examples-smoke.test.ts`
