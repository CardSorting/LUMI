---
title: "Agent Stack"
sidebarTitle: "Agent Stack"
description: "How LUMI (agent session) and BroccoliDB (substrate) fit together in the monorepo."
---

# Agent stack

The [LUMI monorepo](https://github.com/CardSorting/LUMI) ships **two complementary layers**. This page is the canonical map between them. For how the repo evolved from Cline through DietCode to LUMI, see [EVOLUTION.md](EVOLUTION.md).

## Two layers

| Layer | Product | Code | Primary question |
|-------|---------|------|------------------|
| **Session** | LUMI | `src/`, `webview-ui/` | What should we do in the IDE, with my approval? |
| **Substrate** | BroccoliDB | `broccolidb/` | What happened to the repo, and is structure still true? |

```
┌──────────────────────────────────────────────────────────────┐
│  LUMI  ·  CardSorting.lumi  ·  VS Code extension             │
│  ─────────────────────────────────────────────────────────── │
│  Webview (React)  ↔  Controller  ↔  Task loop  ↔  Tools      │
│  Approval · Plan/Act · MCP · Subagents · Hooks               │
│  Docs: docs/papers/*  ·  docs/architecture/current.md        │
└────────────────────────────┬─────────────────────────────────┘
                             │ @noorm/broccolidb
                             │ mem_* tools · dietcode_kernel · Spider
┌────────────────────────────▼─────────────────────────────────┐
│  BroccoliDB  ·  @noorm/broccolidb                            │
│  ─────────────────────────────────────────────────────────── │
│  Capabilities · Runtime graph · Snapshots · RepairExecutor   │
│  Docs: broccolidb/docs/papers/*                              │
└──────────────────────────────────────────────────────────────┘
```

**Do not merge the narratives.** Calm sidebar UX is not substrate discipline.

## LUMI session flow (verified)

| Step | Component | Path |
|------|-----------|------|
| 1 | Extension activation | `src/extension.ts` |
| 2 | Host injection | `src/hosts/host-provider.ts` |
| 3 | Session controller | `src/core/controller/index.ts` |
| 4 | Agent loop | `src/core/task/index.ts` |
| 5 | LLM call | `src/core/api/index.ts` → 4 wired providers |
| 6 | Tool routing | `src/core/task/tools/ToolExecutorCoordinator.ts` |
| 7 | Physical I/O | `src/hosts/vscode/hostbridge/` |
| 8 | User approval | `webview-ui/` diff + tool cards |
| 9 | Completion | `completionGatePipeline.ts` |
| 10 | Governed swarm | `use_subagents` → projection → reconcile → coordinator commit → seal |

## Governed swarms (when `use_subagents` runs parallel lanes)

Multi-lane swarms use **per-agent roadmap projections** — lanes do not mutate the shared kanban directly.

| Concern | Mechanism |
|---------|-----------|
| File mutation | `LockAuthority` when `mutation` mode |
| Roadmap mutation | `propose_patch` → `runRoadmapPatchReconciliation` → `commitWorkspaceRoadmapPatches` |
| Operator visibility | `GovernedReceiptPanel` — accepted/rejected patches, commit status |

Quick reference: [governed-roadmap-projection-quickref.md](governed-roadmap-projection-quickref.md) · Architecture: [governed-subagent-execution.md](governed-subagent-execution.md).

## BroccoliDB touchpoints in LUMI

| Concern | LUMI integration |
|---------|-------------------|
| Cognitive memory | `CognitiveMemory*Handler` tools |
| Runtime kernel | `DietcodeKernelToolHandler` |
| Structural audit | `src/core/policy/spider/` |
| SQLite pool | `src/infrastructure/db/BufferedDbPool` |

Runtime API reference: [api/README.md](api/README.md).

## Documentation map

| Audience | Start here |
|----------|------------|
| New user | [Quick start](getting-started/quick-start.mdx) |
| Executive | [Companion brief](papers/companion-brief.md) |
| Designer / lead | [Philosophy](papers/philosophy.md) |
| Engineer | [Whitepaper](papers/whitepaper.md) · [Project map](PROJECT_MAP.md) |
| Swarm harness author | [Roadmap projection quick reference](governed-roadmap-projection-quickref.md) |
| Swarm operator | [Governed execution runbook](governed-execution-runbook.md) |
| Substrate integrator | [BroccoliDB docs](../broccolidb/docs/README.md) |

## Trust boundaries

| Boundary | Enforced by |
|----------|-------------|
| No silent file writes | Tool approval + diff view |
| No unbounded completion | `attempt_completion` gates |
| No unscoped context | `.dietcodeignore` |
| No hook bypass | Hook executor on lifecycle events |
| No substrate skip | Tools call BroccoliDB capabilities, not raw disk repair |
| No parallel kanban smuggling | Local events + patch quality gate; coordinator-only workspace commit |

Details: [Security best practices](SECURITY_BEST_PRACTICES.md).

## Verify the stack

```bash
# Agent layer
npm run docs:check-agent-links
npm run check-types && npm run test:unit

# Substrate layer
cd broccolidb && npm run test:guardrails
```
