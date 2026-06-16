# BroccoliDB Documentation

BroccoliDB v30 is a **stable operational substrate** for agent-driven code work.

## Start here

| Doc | Purpose |
|-----|---------|
| [Getting started](getting-started.md) | Install, lifecycle pattern, first capability calls |
| [Public API](public-api.md) | Frozen stable surface |
| [CLI](cli.md) | `broccolidb health`, `spider`, `runtime` commands |
| [Examples](examples.md) | Golden-path scripts under `broccolidb/examples/` |
| [Errors](errors.md) | Typed errors with fixes |
| [Architecture (current)](architecture/current.md) | How the system fits together today |

## Release

| Doc | Purpose |
|-----|---------|
| [API stability](../broccolidb/API_STABILITY.md) | Stable vs internal APIs |
| [Migration](../broccolidb/MIGRATION.md) | Upgrading from pre-v30 patterns |
| [Changelog](../broccolidb/CHANGELOG.md) | Version history |

## History

Milestone excavation docs live under [history/](history/) — useful for archaeology, not day-to-day operation.

## Doctrine

Agents express intent. Capabilities validate intent. Runtime governs execution. Spider proves structure. StateGraph preserves truth. Snapshots preserve continuity. Replay reconstructs causality.
