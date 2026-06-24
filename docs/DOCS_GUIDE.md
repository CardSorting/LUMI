# Documentation Guide

Map of LUMI agent workspace documentation. BroccoliDB docs are maintained separately under `broccolidb/docs/`.

## Principles

1. **1-to-1 with code** — Architecture pages mirror real paths under `src/` and `webview-ui/`.
2. **LUMI user-facing** — Product name is LUMI; `DietCode` appears only for internal types and legacy filenames.
3. **Accurate scope** — This build ships a VS Code extension with four wired LLM providers (see `src/shared/providers/providers.json`).
4. **BroccoliDB boundary** — Runtime/store docs live in `broccolidb/docs/`; `docs/api/` covers agent-facing BroccoliDB capabilities.

## Documentation map

### Getting started

| Doc | Purpose |
|-----|---------|
| [home.mdx](home.mdx) | Landing page |
| [getting-started/quick-start.mdx](getting-started/quick-start.mdx) | Install + first task |
| [getting-started/what-is-dietcode.mdx](getting-started/what-is-dietcode.mdx) | Product overview (LUMI) |
| [getting-started/installing-dietcode.mdx](getting-started/installing-dietcode.mdx) | VSIX / marketplace install |
| [getting-started/authorizing-with-dietcode.mdx](getting-started/authorizing-with-dietcode.mdx) | API keys and auth |
| [getting-started/your-first-project.mdx](getting-started/your-first-project.mdx) | Tutorial |
| [getting-started/glossary.mdx](getting-started/glossary.mdx) | Term definitions |

### User guide

| Doc | Purpose |
|-----|---------|
| [core-workflows/task-management.mdx](core-workflows/task-management.mdx) | Tasks and history |
| [core-workflows/plan-and-act.mdx](core-workflows/plan-and-act.mdx) | Plan vs Act modes |
| [core-workflows/working-with-files.mdx](core-workflows/working-with-files.mdx) | @ mentions |
| [core-workflows/using-commands.mdx](core-workflows/using-commands.mdx) | Slash commands |
| [core-workflows/checkpoints.mdx](core-workflows/checkpoints.mdx) | Checkpoints |
| [tools-reference/README.mdx](tools-reference/README.mdx) | Tools index |
| [tools-reference/all-dietcode-tools.mdx](tools-reference/all-dietcode-tools.mdx) | Tool enum reference |
| [core-features/model-selection-guide.mdx](core-features/model-selection-guide.mdx) | Providers |

### Customization & features

| Doc | Purpose |
|-----|---------|
| [customization/hooks.mdx](customization/hooks.mdx) | Lifecycle hooks |
| [customization/skills.mdx](customization/skills.mdx) | Agent skills |
| [customization/workflows.mdx](customization/workflows.mdx) | Slash workflows |
| [customization/dietcode-rules.mdx](customization/dietcode-rules.mdx) | Project rules |
| [features/subagents.mdx](features/subagents.mdx) | Background agents |
| [features/roadmap-steering.mdx](features/roadmap-steering.mdx) | ROADMAP.md gates + auto-governance at completion |
| [features/roadmap-auto-governance-postmortem.mdx](features/roadmap-auto-governance-postmortem.mdx) | Post-mortem: manual validate loops → internal remediation |
| [features/auto-approve.mdx](features/auto-approve.mdx) | Auto-approval |
| [provider-config/README.mdx](provider-config/README.mdx) | Active vs legacy providers |
| [mcp/mcp-overview.mdx](mcp/mcp-overview.mdx) | MCP integration |

### Architecture

| Doc | Purpose |
|-----|---------|
| [PROJECT_MAP.md](PROJECT_MAP.md) | Directory map |
| [architecture/current.md](architecture/current.md) | System architecture |
| [papers/philosophy.md](papers/philosophy.md) | Calm agency — design values |
| [papers/companion-brief.md](papers/companion-brief.md) | Executive metrics |
| [papers/whitepaper.md](papers/whitepaper.md) | Technical depth |
| [api/README.md](api/README.md) | BroccoliDB runtime API index |
| [AGENT_STACK.md](AGENT_STACK.md) | Two-layer hub |
| [CODE_TO_DOC_MAP.md](CODE_TO_DOC_MAP.md) | Source → doc lookup |
| [papers/README.md](papers/README.md) | Papers reading order |
| [SYSTEM_COMMUNICATION.md](SYSTEM_COMMUNICATION.md) | IPC and host bridge |
| [grpc-subscription-persistence.md](grpc-subscription-persistence.md) | Persistent `subscribeTo*` streams, idle-timeout bug, client/server runtime |
| [MEMORY_AND_REASONING.md](MEMORY_AND_REASONING.md) | Context and memory tools |
| [WORKING_WITH_SUBAGENTS.md](WORKING_WITH_SUBAGENTS.md) | Subagent protocol |
| [governed-subagent-execution.md](governed-subagent-execution.md) | Governed swarm architecture, roadmap/audit integration, closure invariants |
| [governed-execution-runbook.md](governed-execution-runbook.md) | Governed swarm operator playbook |
| [governed-execution-schema.md](governed-execution-schema.md) | Governed receipt schema v3 |
| [governed-execution-decisions.md](governed-execution-decisions.md) | Governed execution ADRs |
| [SECURITY_BEST_PRACTICES.md](SECURITY_BEST_PRACTICES.md) | Safety model |
| [MAINTAINER.md](MAINTAINER.md) | Doc CI, branding, update checklist |

### BroccoliDB (external to this guide)

See [broccolidb/docs/README.md](../broccolidb/docs/README.md).

Agent-facing API notes: `docs/api/` (Spider ergonomics, snapshots, replay, execution budgets).

## Local development

```bash
cd docs && npm run dev    # Mintlify dev server
npm run docs:check-links  # from repo root
```

## File naming note

Several paths retain `dietcode` in the filename (historical Mintlify routes). Content describes **LUMI** unless explicitly discussing internal `DietCode*` types.
