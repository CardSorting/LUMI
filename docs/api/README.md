# Runtime API reference (BroccoliDB)

These pages document **BroccoliDB runtime capabilities** used by the LUMI agent — not the VS Code extension surface.

For the extension itself, start with [Architecture (current)](../architecture/current.md) and [Agent papers](../papers/README.md).

## Operator & runtime

| Doc | Topic |
|-----|-------|
| [runtime-modes.md](runtime-modes.md) | Development, CI, production, readonly, recovery, forensic |
| [runtime-state.md](runtime-state.md) | Runtime state graph |
| [runtime-events.md](runtime-events.md) | Event bus |
| [runtime-story.md](runtime-story.md) | Session narrative |
| [runtime-operator-views.md](runtime-operator-views.md) | Operator CLI views |
| [execution-sessions.md](execution-sessions.md) | Session lifecycle |
| [execution-budgets.md](execution-budgets.md) | Budget enforcement |

## Proof & repair

| Doc | Topic |
|-----|-------|
| [spider-agent-ergonomics.md](spider-agent-ergonomics.md) | Spider `check({ phase })` for agents |
| [spider-report.md](spider-report.md) | Forensic report shape |
| [repair-directives.md](repair-directives.md) | Repair directive contract |
| [verification-pipeline.md](verification-pipeline.md) | Post-execute verification |
| [mutation-plans.md](mutation-plans.md) | Mutation planning |
| [runtime-integrity.md](runtime-integrity.md) | RTG integrity |
| [intent-tracing.md](intent-tracing.md) | Capability intent traces |

## Snapshots & replay

| Doc | Topic |
|-----|-------|
| [runtime-snapshots.md](runtime-snapshots.md) | Snapshot store |
| [runtime-replay.md](runtime-replay.md) | Replay hydrator |
| [replay-system.md](replay-system.md) | Replay overview |

## Capabilities

See [broccolidb/docs/public-api.md](../../broccolidb/docs/public-api.md) for the frozen `@noorm/broccolidb` export surface.

Capability detail stubs under [capabilities/](capabilities/) mirror BroccoliDB intent types (query, graph, audit, storage, …).

## Agent integration points in LUMI

| LUMI location | BroccoliDB concern |
|---------------|-------------------|
| `CognitiveMemory*Handler` | Graph / query capabilities |
| `DietcodeKernelToolHandler` | Runtime kernel |
| `src/core/policy/spider/` | Spider engine bridge |
| `src/infrastructure/db/BufferedDbPool` | SQLite pool |

Full substrate docs: [broccolidb/docs/README.md](../../broccolidb/docs/README.md).
