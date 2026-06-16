# LUMI documentation

Documentation for the **LUMI** VS Code extension and agent workspace (`src/`, `webview-ui/`). BroccoliDB has its own docs — do not duplicate them here.

## Start here

| Doc | Description |
|-----|-------------|
| [Home](home.mdx) | Documentation landing page |
| [Agent stack](AGENT_STACK.md) | LUMI + BroccoliDB two-layer map |
| [Quick start](getting-started/quick-start.mdx) | Install and first task |
| [What is LUMI?](getting-started/what-is-dietcode.mdx) | Product overview |
| [Project map](PROJECT_MAP.md) | 1-to-1 map of `src/` directories |
| [Code ↔ docs](CODE_TO_DOC_MAP.md) | Source path → doc page lookup |
| [Maintainer guide](MAINTAINER.md) | CI checks, branding rules, update checklist |

## User guide

| Topic | Doc |
|-------|-----|
| Tasks | [core-workflows/task-management.mdx](core-workflows/task-management.mdx) |
| Plan & Act modes | [core-workflows/plan-and-act.mdx](core-workflows/plan-and-act.mdx) |
| Files & @ mentions | [core-workflows/working-with-files.mdx](core-workflows/working-with-files.mdx) |
| Slash commands | [core-workflows/using-commands.mdx](core-workflows/using-commands.mdx) |
| Checkpoints | [core-workflows/checkpoints.mdx](core-workflows/checkpoints.mdx) |
| All tools | [tools-reference/all-dietcode-tools.mdx](tools-reference/all-dietcode-tools.mdx) |
| Tools index | [tools-reference/README.mdx](tools-reference/README.mdx) |
| Model selection | [core-features/model-selection-guide.mdx](core-features/model-selection-guide.mdx) |

## Features

| Feature | Doc |
|---------|-----|
| Auto-approve | [features/auto-approve.mdx](features/auto-approve.mdx) |
| Focus chain | [features/focus-chain.mdx](features/focus-chain.mdx) |
| Subagents | [features/subagents.mdx](features/subagents.mdx) |
| Hooks | [customization/hooks.mdx](customization/hooks.mdx) |
| Skills | [customization/skills.mdx](customization/skills.mdx) |
| Workflows | [customization/workflows.mdx](customization/workflows.mdx) |
| Rules | [customization/dietcode-rules.mdx](customization/dietcode-rules.mdx) |
| MCP | [mcp/mcp-overview.mdx](mcp/mcp-overview.mdx) |
| Roadmap steering | [features/roadmap-steering.mdx](features/roadmap-steering.mdx) |
| Providers (active) | [provider-config/README.mdx](provider-config/README.mdx) |

## Architecture & internals

| Doc | Description |
|-----|-------------|
| [Agent stack](AGENT_STACK.md) | Two-layer map (LUMI + BroccoliDB) |
| [Architecture (current)](architecture/current.md) | Extension module structure |
| [System communication](SYSTEM_COMMUNICATION.md) | gRPC host bridge, webview messaging |
| [Memory & reasoning](MEMORY_AND_REASONING.md) | Context, cognitive memory tools |
| [Working with subagents](WORKING_WITH_SUBAGENTS.md) | Background agent delegation |
| [Security best practices](SECURITY_BEST_PRACTICES.md) | Approval gates, ignore files |
| [Spider forensic engine](architecture/spider-v20-forensic-engine.md) | Policy/audit layer (BroccoliDB) |
| [User interface design](USER_INTERFACE_DESIGN.md) | Webview UX patterns |

## Papers

| Doc | Path |
|-----|------|
| Index | [papers/README.md](papers/README.md) |
| Philosophy | [papers/philosophy.md](papers/philosophy.md) |
| Companion brief | [papers/companion-brief.md](papers/companion-brief.md) |
| Technical whitepaper | [papers/whitepaper.md](papers/whitepaper.md) |

## Runtime API (BroccoliDB)

Agent-facing substrate API notes: [api/README.md](api/README.md)

## BroccoliDB (separate package)

Context store, CLI, and runtime API docs live under **[broccolidb/docs/README.md](../broccolidb/docs/README.md)**.

Extended runtime API reference (Spider ergonomics, snapshots, replay) remains under `docs/api/` and points at BroccoliDB capabilities used by the agent.

## History

Architecture milestone notes: [history/architecture/](history/architecture/)
