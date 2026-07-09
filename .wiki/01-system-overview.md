# 01 System Overview

Last audited: 2026-07-09

This wiki page is a compact mirror of the current workspace operating model. The root [Workspace Wiki](../WIKI.md) is the agent-ready stable reference; this file keeps the historical `.wiki` tree aligned enough to avoid stale onboarding.

## Architecture

LUMI is a VS Code extension monorepo with two complementary layers:

| Layer | Paths | Responsibility |
|---|---|---|
| LUMI session layer | `src/`, `webview-ui/`, `proto/` | VS Code activation, webview UI, task loop, tools, providers, MCP, hooks, completion gates |
| BroccoliDB substrate | `broccolidb/` | Local cognitive memory, runtime graph, Spider/repair substrate, durable snapshots |

Do not merge the narratives. LUMI owns IDE session behavior and approval gates. BroccoliDB owns substrate truth and runtime graph capabilities.

## Request Flow

```text
src/extension.ts
  -> HostProvider
  -> VscodeWebviewProvider
  -> Controller
  -> Task
  -> buildApiHandler(mode)
  -> LLM stream
  -> ToolExecutorCoordinator
  -> tool handlers / HostProvider / MCP / BroccoliDB
  -> completion lifecycle decision engine
  -> run_finalization / receipt seal
```

## Current Boundaries

| Subsystem | Primary path |
|---|---|
| Extension activation | `src/extension.ts` |
| Controller | `src/core/controller/` |
| Agent loop | `src/core/task/` |
| Tools | `src/core/task/tools/`, `src/shared/tools.ts` |
| Completion/finalization | `src/core/task/tools/completion/`, `src/core/task/tools/finalization/` |
| Providers | `src/core/api/`, `src/shared/providers/providers.json` |
| Prompts | `src/core/prompts/system-prompt/` |
| Webview UI | `webview-ui/` |
| Protocol | `proto/`, `src/generated/` |
| Roadmap/governance | `src/services/roadmap/`, `ROADMAP.md` |
| Substrate package | `broccolidb/` |

## Agent Continuity Layer

Root operating docs now define the workspace continuity contract:

- [Agent Playbook](../AGENT_PLAYBOOK.md)
- [Workspace Wiki](../WIKI.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
- [Decisions](../DECISIONS.md)
- [Handoff](../HANDOFF.md)

`run_finalization` now also generates managed `.wiki/agent/*` playbook artifacts from workspace evidence. Managed sections should be replaced in place instead of appended repeatedly.

## Known Drift

| Drift | Current source of truth |
|---|---|
| Older `.wiki` pages use DietCode-era naming | `package.json`, README, `docs/EVOLUTION.md` |
| Some docs say four providers | `src/core/api/index.ts` and `src/shared/providers/providers.json` list five provider keys |
| `ROADMAP.md` contains stale bootstrap text | Maintained docs and implementation until roadmap repair pass |

