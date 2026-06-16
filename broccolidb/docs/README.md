# BroccoliDB documentation

BroccoliDB v30 is a **stable operational substrate**. These docs describe the final system — not milestone-by-milestone excavation.

## Start here

| Doc | Purpose |
|-----|---------|
| [Getting started](getting-started.md) | Install, lifecycle, first capability calls |
| [Public API](public-api.md) | Frozen stable surface (`core/public-api.ts`) |
| [CLI](cli.md) | `health`, `spider`, `runtime` commands |
| [Examples](examples.md) | Golden-path scripts in `../examples/` |
| [Errors](errors.md) | Typed errors with cause, fix, and docs link |
| [Architecture (current)](architecture/current.md) | Layers, flow, runtime modes |

## Release & policy

| Doc | Purpose |
|-----|---------|
| [API stability](../API_STABILITY.md) | Stable, internal, forbidden patterns |
| [Migration](../MIGRATION.md) | Upgrading from pre-v30 |
| [Changelog](../CHANGELOG.md) | Version history |

## Papers

| Doc | Audience | Purpose |
|-----|----------|---------|
| [Technical whitepaper](papers/whitepaper.md) | Engineers, architects | Full system treatment — workspace-verified metrics |
| [Companion brief](papers/companion-brief.md) | Leads, evaluators | Executive summary with measured counts |
| [Philosophy](papers/philosophy.md) | Builders, policy | Values tied to code and tests |

## Extended API reference (repo)

Detailed capability and runtime API notes live in the repository root:

- [Spider agent ergonomics](../../docs/api/spider-agent-ergonomics.md)
- [Runtime snapshots](../../docs/api/runtime-snapshots.md)
- [Runtime replay](../../docs/api/runtime-replay.md)
- [Execution budgets](../../docs/api/execution-budgets.md)

## History

Milestone architecture docs are archived under [../../docs/history/architecture/](../../docs/history/architecture/) for archaeology only.

## Doctrine

A complete structure is not finished until it is boring to operate.

Agents express intent → capabilities validate → runtime governs → Spider proves structure → StateGraph preserves truth → snapshots preserve continuity → replay reconstructs causality.
