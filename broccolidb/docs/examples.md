# Examples

Golden-path scripts live in [`../examples/`](../examples/). Each demonstrates the v30 rules:

1. `await ctx.start()` before capabilities
2. Use capability APIs only (no raw services)
3. `await ctx.stop()` in `finally`
4. Typed errors where relevant
5. Printed output you can assert in CI

## Run one

```bash
cd broccolidb
npx tsx examples/basic-context.ts
```

## Catalog

| Script | Demonstrates |
|--------|----------------|
| [`basic-context.ts`](../examples/basic-context.ts) | Lifecycle, `ctx.health()`, capability registry |
| [`lifecycle-error.ts`](../examples/lifecycle-error.ts) | `GuidedError` on capability-before-start |
| [`spider-gate.ts`](../examples/spider-gate.ts) | `ctx.graph.spider.audit` + `.gate` with runtime session |
| [`repair-flow.ts`](../examples/repair-flow.ts) | Audit → plan → preview (no silent mutation) |
| [`runtime-replay.ts`](../examples/runtime-replay.ts) | Snapshot, process restart, replay, story |
| [`health-check.ts`](../examples/health-check.ts) | Deep health + `getMemoryHealth()` |
| [`ci-gate.ts`](../examples/ci-gate.ts) | `spider.check` + `formatCheckDigest` for pipelines |

## Shared bootstrap

[`../examples/_bootstrap.ts`](../examples/_bootstrap.ts) provides:

- `withExampleContext(fn)` — temp workspace, start/stop lifecycle
- `seedMinimalProject(root)` — minimal TypeScript project for Spider
- `runExampleMain(main)` — clean process exit for standalone scripts

## Smoke test

```bash
npm run test:examples
```

Runs all golden-path scripts and asserts exit codes and output.

## Rules (do not bypass)

| Rule | Why |
|------|-----|
| No `SpiderService` imports | Bypasses intent tracing and lifecycle guards |
| No capabilities before `start()` | Throws `GuidedError` by design |
| No Spider mutation during audit | Forensic integrity |
| Repairs via `ctx.runtime.execute` only | Single governed mutation path |
