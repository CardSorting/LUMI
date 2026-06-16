# Changelog

## v30.0.0 — Platform stabilization

**Theme:** Boring, teachable, hard to misuse. No new architecture layers.

### Added

- Frozen public API (`broccolidb/core/public-api.ts`)
- Actionable `GuidedError` for lifecycle misuse
- CLI: `health`, `spider gate|compact`, `runtime state|replay|story|snapshot`
- Golden-path examples under `broccolidb/examples/`
- Guardrail tests: public API snapshot, examples smoke, docs links, CLI smoke, error messages, experimental naming
- Runtime recovery smoke test (snapshot survives restart)
- Consolidated docs: getting-started, public-api, errors, cli, examples, architecture/current
- `API_STABILITY.md`, `MIGRATION.md`

### Changed

- Package entry (`index.ts`) exports stable surface only
- Lifecycle errors include cause, fix, and docs link

### Removed from public exports

- Direct re-exports of internal orchestration classes (MutationPlanner, RuntimeGraphStore, etc.)
- Legacy barrel exports (connection, mcp, watcher, …) from package root

## v29 — Durable operational memory

Runtime graph persistence, snapshots, replay hydrator, integrity verifier, story builder.

## v28 — Runtime state graph

Canonical `RuntimeStateGraph` and operator views.

## v27 — Runtime governance

Modes, budgets, scheduling, journaling, events.

## v26 — Substrate convergence

Unified orchestration pipeline: plan → approve → execute → verify → rollback.
