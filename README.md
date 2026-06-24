# LUMI

<p align="center">
  <img src="assets/icons/icon.png" alt="LUMI" width="96" />
</p>

<p align="center">
  <strong>A calm coding companion — comfort-first agentic pair programming inside VS Code.</strong>
</p>

<p align="center">
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/papers/companion-brief.md">Papers</a> ·
  <a href="docs/governed-subagent-execution.md">Governed swarms</a> ·
  <a href="docs/SECURITY_BEST_PRACTICES.md">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/CardSorting/LUMI/discussions">Discussions</a> ·
  <a href="https://github.com/CardSorting/LUMI/issues">Issues</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CardSorting/LUMI" alt="License" /></a>
  <a href="https://github.com/CardSorting/LUMI/actions/workflows/test.yml"><img src="https://github.com/CardSorting/LUMI/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://github.com/CardSorting/LUMI/actions/workflows/e2e.yml"><img src="https://github.com/CardSorting/LUMI/actions/workflows/e2e.yml/badge.svg" alt="E2E" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/version-2.1.0-green" alt="Version" /></a>
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.84.0-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code" />
  <img src="https://img.shields.io/badge/extension-CardSorting.lumi--vscode-purple" alt="VS Marketplace ID" />
  <img src="https://img.shields.io/badge/Open%20VSX-CardSorting.lumi-blue" alt="Open VSX ID" />
  <img src="https://img.shields.io/badge/tools-63-orange" alt="Tools" />
  <img src="https://img.shields.io/badge/providers-4-blue" alt="Providers" />
  <a href="https://github.com/CardSorting/LUMI"><img src="https://img.shields.io/github/stars/CardSorting/LUMI?style=social" alt="GitHub" /></a>
</p>

<p align="center">
  <img src="assets/docs/demo.gif" alt="LUMI demo — chat, approval, and file edits in VS Code" width="720" />
</p>

> **Human-in-the-loop by default:** diff before write, checkpoint after tool use, completion gates before “done.” Auto-approve and YOLO mode exist — pair them with [checkpoints](docs/core-workflows/checkpoints.mdx).

> **Doctrine:** User expresses intent → Controller holds session → Task runs the loop → Tools execute with approval → Checkpoints preserve rollback → Completion is earned through gates.

> **Governed swarms:** Locks protect mutation. Receipts preserve truth. Private projection is cheap — workspace roadmap truth is coordinator-owned.

<p align="center">
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#governed-subagent-execution"><strong>Governed swarms</strong></a> ·
  <a href="#documentation"><strong>Docs</strong></a> ·
  <a href="#development"><strong>Develop</strong></a> ·
  <a href="#getting-help"><strong>Help</strong></a>
</p>

```bash
# VS Code Marketplace (CardSorting.lumi-vscode)
code --install-extension CardSorting.lumi-vscode
# Open VSX / Cursor registry (CardSorting.lumi)
code --install-extension CardSorting.lumi
# Or from a VSIX build:
npm run package:vsix && code --install-extension dist/*.vsix
```

---

## Table of contents

- [Overview](#overview)
- [Why LUMI](#why-lumi)
- [Who LUMI is for](#who-lumi-is-for)
- [How LUMI differs](#how-lumi-differs)
- [Local-first & data](#local-first--data)
- [Compatibility](#compatibility)
- [Install](#install)
- [Quick start](#quick-start)
- [Project configuration](#project-configuration)
- [@ mentions](#-mentions)
- [Recommended workflows](#recommended-workflows)
- [Performance & context](#performance--context)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Active providers](#active-providers)
- [Capabilities](#capabilities)
- [Governed subagent execution](#governed-subagent-execution)
- [Plan & Act modes](#plan--act-modes)
- [Built-in slash commands](#built-in-slash-commands)
- [Lifecycle hooks](#lifecycle-hooks)
- [Key VS Code settings](#key-vs-code-settings)
- [How a task flows](#how-a-task-flows)
- [Trust model](#trust-model)
- [Architecture at a glance](#architecture-at-a-glance)
- [Monorepo packages](#monorepo-packages)
- [Tech stack](#tech-stack)
- [Documentation](#documentation)
- [Papers](#papers)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Getting help](#getting-help)
- [Security & trust](#security--trust)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**LUMI** (VS Marketplace: `CardSorting.lumi-vscode`, Open VSX: `CardSorting.lumi`) is a VS Code extension that acts as an agentic pair programmer: it reads your workspace, plans changes, runs terminal commands, uses a browser, connects MCP servers, and edits files — with **explicit approval at every mutating step**.

Task history and cognitive memory use **BroccoliDB** (`@noorm/broccolidb`) locally. Multi-lane **governed swarms** (`use_subagents`) produce durable receipts, conditional mutation locks, and a merge gate — so parallel agents do not false-positive collide on reads.

The sidebar UX is designed for **long sessions** without alert fatigue.

| | |
|---|---|
| **Publisher** | CardSorting |
| **Extension ID (VS Marketplace)** | `CardSorting.lumi-vscode` |
| **Extension ID (Open VSX)** | `CardSorting.lumi` |
| **License** | [Apache-2.0](LICENSE) |
| **Repository** | [github.com/CardSorting/LUMI](https://github.com/CardSorting/LUMI) |
| **Homepage** | [dietcode.io](https://dietcode.io) |
| **Changelog** | [changelogv3.md](changelogv3.md) |
| **Monorepo** | npm workspaces: root extension + `broccolidb/` package |
| **Marketplace** | VS Marketplace: **CardSorting.lumi-vscode** · Open VSX: **CardSorting.lumi** (search **LUMI**) |
| **Enterprise** | [docs/ENTERPRISE_DEPLOYMENT.md](docs/ENTERPRISE_DEPLOYMENT.md) — on-prem / self-hosted |

Workspace-verified metrics: [docs/papers/companion-brief.md](docs/papers/companion-brief.md).

### By the numbers

| Metric | Value |
|--------|-------|
| Typed tools | **63** (`src/shared/tools.ts`) |
| Read-only tools | **12** (`READ_ONLY_TOOLS`) |
| Wired providers | **4** (`providers.json`) |
| Slash commands | **10** |
| Hook kinds | **8** |
| Agent modes | **plan** · **act** |
| Governed receipt schema | **v3** |

---

## Why LUMI

Five design pillars — each maps to code, not marketing copy. Full treatment: [docs/papers/philosophy.md](docs/papers/philosophy.md).

| Pillar | What it means in practice |
|--------|---------------------------|
| **Calm agency** | Sidebar stays readable; you approve mutating work on your schedule |
| **Typed tools** | 63 enum values in `src/shared/tools.ts` → dedicated handlers — no ad-hoc shell |
| **Plan before mutate** | Plan mode + `plan_mode_respond` before Act mode file changes |
| **Provable finish** | `attempt_completion` runs through `completionGatePipeline.ts` — “done” is gated |
| **Governed parallelism** | Subagent lanes declare execution mode; locks protect mutation, receipts preserve truth |

BroccoliDB handles **substrate truth** (structure, snapshots, Spider). LUMI handles **the human session** (chat, diffs, terminal, MCP). Do not confuse the two: [docs/AGENT_STACK.md](docs/AGENT_STACK.md).

---

## Who LUMI is for

| Persona | LUMI fit |
|---------|----------|
| **Solo developer** | Pair program in-editor with approval gates and checkpoints |
| **Tech lead** | Roadmap steering, hooks, `.dietcoderules/` for team guardrails |
| **Agent integrator** | MCP servers, governed subagents, typed tool surface to extend |
| **Platform operator** | Governed receipt incident console, merge gate violations, retry lineage |
| **Substrate engineer** | BroccoliDB package for durable context — [broccolidb/README.md](broccolidb/README.md) |
| **Doc contributor** | Measured papers + [docs/MAINTAINER.md](docs/MAINTAINER.md) CI guardrails |

Not a fit: fully autonomous unattended agents (LUMI assumes a human approver in the loop).

---

## How LUMI differs

| Typical autonomous agent | LUMI |
|--------------------------|------|
| Runs until stopped | **Approval gate** per mutating tool call |
| Opaque file changes | **Diff view** before write lands |
| Hard to undo | **Checkpoints** — shadow Git after each tool use |
| “Done” when model says so | **Completion pipeline** + roadmap gates |
| Generic shell access | **63 typed tools** with dedicated handlers |
| External memory app | **BroccoliDB** integrated locally |
| Parallel agents collide on reads | **Lock-necessity classifier** — read/audit lanes skip locks; merge gate scopes collisions to writes |
| Chat as audit trail | **Durable governed receipts** per swarm attempt |

---

## Local-first & data

| Data | Location | Notes |
|------|----------|-------|
| **Settings & task refs** | `~/.dietcode/data/` | `globalState.json`, per-workspace state (`createStorageContext`) |
| **API keys / secrets** | `~/.dietcode/data/secrets.json` | Mode `0600` — owner read/write only |
| **BroccoliDB SQLite** | `./dietcode.db` (workspace cwd) | Local cognitive memory / runtime graph |
| **Checkpoints** | VS Code `globalStorage/checkpoints/` | Shadow Git — not your project `.git/` |
| **Swarm envelopes** | `{taskDir}/subagent_executions/{swarmId}.json` | Per-swarm execution artifact |
| **Governed receipts** | `{taskDir}/subagent_executions/{swarmId}.governed.{attemptId}.json` | Immutable per-attempt receipt (schema v3) |
| **Receipt history** | `{taskDir}/subagent_executions/{swarmId}.governed.history.jsonl` | Append-only attempt lineage |
| **Lane transcripts** | `{taskDir}/subagent_executions/{swarmId}/agents/*.transcript.jsonl` | Append-only lane event logs |
| **Cross-process locks** | `.broccolidb/governed/locks/` · `fencing/` | File lock + fencing token files |
| **LLM requests** | Your chosen provider | Code context sent to OpenRouter, OpenAI, NousResearch, or Cloudflare when you run a task |

Override storage root: `DIETCODE_DIR` or `CLINE_DIR` env var. Details: [docs/SECURITY_BEST_PRACTICES.md](docs/SECURITY_BEST_PRACTICES.md).

---

## Compatibility

| Environment | Support | Notes |
|-------------|---------|-------|
| **VS Code 1.84+** | Full | Primary target (`package.json` `engines.vscode`) |
| **Cursor** | VSIX / marketplace | VS Code–compatible; install `CardSorting.lumi` (Open VSX) or `CardSorting.lumi-vscode` (VS Marketplace) |
| **Git** | Required for checkpoints | Shadow Git repo in extension global storage |
| **Node.js 20+** | Development only | Not required for end users installing from marketplace |
| **git-lfs** | Clone only | Required when cloning this repository |

**Conflict:** Disable other DietCode forks (`dreambeesai.dietcode`, `dietcode.dietcode`) to avoid activity bar collisions.

---

## Install

### Prerequisites

- VS Code **1.84+** (or Cursor with extension support)
- **Git** on `PATH` (for checkpoints)
- API credentials for one [active provider](#active-providers)

### Methods

| Method | Command / action |
|--------|------------------|
| **Marketplace** | Extensions → search **LUMI** → **CardSorting.lumi-vscode** (VS Code) or **CardSorting.lumi** (Open VSX) |
| **VSIX** | `npm run package:vsix` → `code --install-extension dist/lumi-vscode-<version>.vsix` |
| **From source** | See [Development](#development) → press **F5** in VS Code |

Provider setup: [docs/provider-config/README.mdx](docs/provider-config/README.mdx) · Full walkthrough: [docs/getting-started/quick-start.mdx](docs/getting-started/quick-start.mdx).

---

## Quick start

```
1. Open the LUMI activity bar panel
2. Configure a wired provider (Settings → API Provider)
3. Describe a task → review each tool proposal → Approve or Reject
4. (Recommended) Keep checkpoints enabled for one-click rollback
```

**First project tutorial:** [docs/getting-started/your-first-project.mdx](docs/getting-started/your-first-project.mdx)

**Power-user path:** Enable [auto-approve](docs/features/auto-approve.mdx) for reads/edits you trust + [checkpoints](docs/core-workflows/checkpoints.mdx) as your safety net.

**Parallel subagents:** Use `[execution_mode:read_only]` on review lanes so they stay durable without acquiring mutation locks — see [Governed subagent execution](#governed-subagent-execution).

---

## Project configuration

Per-project files LUMI reads from your workspace (primary root in multi-root setups):

| File / directory | Purpose |
|------------------|---------|
| [`.dietcoderules/`](docs/customization/dietcode-rules.mdx) | Project rules — loaded into every request |
| [`.dietcoderules/hooks/`](docs/customization/hooks.mdx) | Lifecycle hook scripts (`TaskStart`, `PreToolUse`, …) |
| [`.dietcodeignore`](docs/customization/dietcodeignore.mdx) | Exclude paths from agent scanning |
| `.dietcodeworkflows/` | Custom slash-command workflows |
| `ROADMAP.md` | Roadmap steering + completion gates ([settings](#key-vs-code-settings)) |

**First setup:** add `.dietcodeignore` early — largest impact on speed and focus. Tutorial: [your-first-project](docs/getting-started/your-first-project.mdx).

**Starter `.dietcodeignore`** (adjust for your stack):

```gitignore
node_modules/
dist/
build/
.next/
coverage/
.env
.env.*
*.log
.git/
```

---

## @ mentions

Type `@` in chat to attach context without copy-paste. Full guide: [working-with-files](docs/core-workflows/working-with-files.mdx).

| Mention | Example | Brings in |
|---------|---------|-----------|
| File | `@/src/index.ts` | Full file content |
| Folder | `@/src/components/` | Directory tree + files (trailing `/`) |
| Problems | `@problems` | Workspace errors/warnings |
| Terminal | `@terminal` | Recent terminal output |
| Git diff | `@git-changes` | Uncommitted changes |
| Commit | `@a1b2c3d` | Specific commit diff |
| URL | `@https://react.dev/...` | Fetched page content |

Multi-root: `@workspace-name:/path/to/file`

---

## Recommended workflows

| Goal | Workflow |
|------|----------|
| **Safe exploration** | Plan mode → approve reads → Act when ready; checkpoints on |
| **Fast iteration** | Auto-approve reads + edits in workspace; restore checkpoint if wrong |
| **Large refactor** | `/deep-planning` → `ROADMAP.md` steering → `/explain-changes` before commit |
| **Team guardrails** | `.dietcoderules/` + `PreToolUse` hooks + `.dietcodeignore` |
| **External tools** | MCP server → approve once → optional per-tool auto-approve |
| **Long session** | `/compact` when context grows; memory tools for cross-task recall |
| **Parallel review** | `use_subagents` with `[execution_mode:read_only]` lanes — no lock collisions on shared reads |
| **Parallel implementation** | Mutation lanes (default) — merge gate reconciles write sets before seal |

---

## Performance & context

Keep sessions fast and within model context windows:

| Lever | Effect |
|-------|--------|
| [`.dietcodeignore`](docs/customization/dietcodeignore.mdx) | Exclude `node_modules/`, build output — largest token savings |
| **Plan mode first** | Read-only exploration before mutating writes |
| **`/compact`** | Condense history when context grows |
| **Smaller models for reads** | Different Plan vs Act providers in settings |
| **Scoped @ mentions** | Attach files/folders you need — not the whole repo |
| **Read-only subagent lanes** | Parallel audit/review without mutation lock overhead |
| **Checkpoints off** | On huge repos if shadow Git is slow (trade rollback for speed) |

Guide: [model selection](docs/core-features/model-selection-guide.mdx) · [memory & reasoning](docs/MEMORY_AND_REASONING.md)

---

## Keyboard shortcuts

From `package.json` `contributes.keybindings`:

| Shortcut (macOS) | Shortcut (Win/Linux) | Action |
|------------------|----------------------|--------|
| `Cmd+'` | `Ctrl+'` | Add selection to chat (`lumi.addToChat`) when text selected |
| `Cmd+'` | `Ctrl+'` | Focus chat input (`lumi.focusChatInput`) when nothing selected |

Context menu: right-click editor → **Add to LUMI** · Terminal → **Add to LUMI**.

### VS Code commands

Registered under `lumi.*` in `package.json` (selection):

| Command | Trigger |
|---------|---------|
| `lumi.focusChatInput` | Focus chat (`Cmd/Ctrl+'` when no selection) |
| `lumi.addToChat` | Add selection to chat |
| `lumi.addTerminalOutputToChat` | Terminal context menu |
| `lumi.generateGitCommitMessage` | SCM input — AI commit message |
| `lumi.explainCode` / `lumi.improveCode` | Editor context menu |
| `lumi.openWalkthrough` | First-run walkthrough |
| `lumi.mcpButtonClicked` | MCP panel in sidebar |

---

## Active providers

Only **four** providers are wired in this build (`src/shared/providers/providers.json` → `buildApiHandler`). Other handler files in the repo are reference-only.

| Provider key | UI label | Doc |
|--------------|----------|-----|
| `openrouter` | OpenRouter | [openrouter.mdx](docs/provider-config/openrouter.mdx) |
| `openai-codex` | ChatGPT Subscription | [openai-codex.mdx](docs/provider-config/openai-codex.mdx) |
| `nousResearch` | NousResearch | [nousresearch.mdx](docs/provider-config/nousresearch.mdx) |
| `cloudflare` | Cloudflare Workers AI | [cloudflare.mdx](docs/provider-config/cloudflare.mdx) |

Model selection guide: [docs/core-features/model-selection-guide.mdx](docs/core-features/model-selection-guide.mdx).

---

## Capabilities

| Capability | Detail |
|------------|--------|
| **63 typed tools** | `DietCodeDefaultTool` enum → `ToolExecutorCoordinator` handlers |
| **Plan & Act modes** | Plan before mutating; Act executes with approval |
| **Checkpoints** | Shadow Git snapshot after each tool use — compare or restore |
| **10 slash commands** | `/compact`, `/newtask`, `/roadmap`, … — see below |
| **MCP** | External tool servers via `McpHub` (`src/services/mcp/`) |
| **Governed subagents** | Parallel lanes with execution modes, merge gate, durable receipts — see below |
| **8 hook kinds** | Lifecycle scripts — see [Lifecycle hooks](#lifecycle-hooks) |
| **Project rules** | `.dietcoderules/` loaded into every request |
| **Roadmap steering** | `ROADMAP.md` + five `lumi.roadmap.*` VS Code settings |
| **BroccoliDB memory** | Cognitive memory tools + Spider structural audit |
| **Spider policy layer** | Forensic audit via `src/core/policy/spider/` — [architecture doc](docs/architecture/spider-v20-forensic-engine.md) |
| **Unified lock authority** | Layered mutation ownership — in-process, SwarmMutex, roadmap lease, file lock, broccoli fence |

Tool reference: [docs/tools-reference/all-dietcode-tools.mdx](docs/tools-reference/all-dietcode-tools.mdx).

---

## Governed subagent execution

Multi-lane swarms via `use_subagents` run through a **governed execution harness**: the parent coordinates, lanes execute with declared intent, and a **merge gate** reconciles parallel work before declaring success.

**North-star invariants:** Locks protect mutation. Receipts preserve truth. Private roadmap state is cheap — workspace roadmap truth is expensive; only the coordinator may spend it.

```mermaid
flowchart LR
  subgraph coord ["Roadmap & audit"]
    AD[scheduleAdmission]
    OL[orchestration lease]
    PF[audit preflight]
  end
  subgraph classify ["Intent"]
    M[execution_mode]
    RW[read_set / write_set]
    DAG[depends_on / roadmap_item]
  end
  subgraph acquire ["Acquire"]
    L{lock required?}
    SK[workLaneClaimWithoutLock]
    LC[LockAuthority.acquire]
  end
  subgraph execute ["Execute"]
    R[SubagentRunner]
    RC[Lane receipt]
  end
  subgraph commit ["Commit"]
    MG[MergeGate]
    PR[patch reconciliation]
    WC[coordinator workspace commit]
    SE[sealReceipt / sealCrashReceipt]
  end
  AD --> OL --> PF --> M
  M --> L
  RW --> L
  DAG --> R
  L -->|no| SK --> R
  L -->|yes| LC --> R
  R --> RC --> MG --> PR --> WC --> SE
```

### Execution modes

Each lane declares how it intends to run. Unmarked lanes default to **`mutation`** (backward compatible).

| Mode | Lock | Typical use |
|------|------|-------------|
| `read_only` | skipped | Code review, inspection |
| `audit_only` | skipped | Receipt / evidence audit |
| `planning_only` | skipped | Design recommendations |
| `documentation_only` | skipped | Doc drafts without writes |
| `diagnostic_only` | skipped | Append-only diagnostic evidence |
| `mutation` | **required** | File edits, durable state changes |

Declare in the lane prompt or tool params:

```
[execution_mode:read_only] [read_set:src/api.ts]
Review the public API without modifying files.
```

Escalation tags (`[write_set:…]`, `[mutates_roadmap]`, `[updates_authoritative_receipt]`) promote non-mutating lanes to lock-required when they declare side effects.

### What you get

| Feature | Benefit |
|---------|---------|
| **Lock-necessity classifier** | Read/audit lanes skip locks — no false collisions on shared files |
| **Roadmap projection** | Per-lane `agentRoadmap`; workspace changes via `propose_patch` → coordinator commit |
| **Roadmap coordination** | Pressure admission + orchestration lease; patch reconciliation at seal |
| **Audit coordination** | Preflight dry-run + per-lane completion gates; `auditIntegration` on receipt (MergeGate = commit barrier only) |
| **Lane DAG** | `[depends_on:N]` ordering + DAG-aware scheduler (concurrency ≤ 3) |
| **Merge gate** | Optimistic parallel execution; write-set reconciliation before commit |
| **Crash sealing** | `sealCrashReceipt` on timeout/abort — authoritative sealed success preserved |
| **Durable receipts** | Schema v3 per-attempt artifacts + `roadmapLinkage` / `auditIntegration` + append-only history |
| **Fencing tokens** | Stale-primary protection on durable mutation claims |
| **Incident console** | `GovernedReceiptPanel` — mode, lock skipped/required, violations, projection patches, retry safety |
| **Attempt lineage** | `attemptId` + `parentAttemptId`; authoritative state survives failed retries |

### Operator essentials

| Question | Answer |
|----------|--------|
| Is **lock skipped** a bug? | No — expected for read/audit/plan lanes |
| Where is truth after a failed retry? | Last `sealed && mergePassed` in `.governed.history.jsonl` |
| Can two lanes read the same file? | Yes — collisions are write-scoped only |
| When is retry safe? | `diagnostics.retrySafe` in the incident console |
| Is MergeGate the audit system? | No — commit barrier only; workspace audit is `completionGatePipeline` |
| Where is swarm audit evidence? | `subagent_executions/` receipts — not BroccoliDB CAS |
| Can lanes mutate workspace roadmap directly? | No — use `[propose_patch:…]`; coordinator commits after reconciliation |
| Optional roadmap update on seal? | Reconciled patches + `roadmap_completion_update=enabled` when merge + integrity pass |

### Coordination planes

| Plane | Owns |
|-------|------|
| Agent roadmap | Private projection — local events, patch proposals |
| Swarm roadmap | Plan linkage — DAG, lane items |
| Workspace roadmap | Authoritative kanban — coordinator commit only |
| Roadmap service | Admission (pressure + orchestration lease) |
| Audit | Verification (preflight + per-lane completion + receipt `auditIntegration`) |
| MergeGate | Commit safety (parallel write reconciliation) |
| BroccoliDB | Fencing / replay substrate only |
| Receipts | Truth under `subagent_executions/` |

### Documentation

| Doc | Audience |
|-----|----------|
| [Roadmap projection quick reference](docs/governed-roadmap-projection-quickref.md) | Authors & operators — patch tags, one page |
| [Governed subagent execution](docs/governed-subagent-execution.md) | Architecture, industry patterns, lifecycle |
| [Governed execution runbook](docs/governed-execution-runbook.md) | Operator playbook, violation catalog, retry flow |
| [Governed execution schema](docs/governed-execution-schema.md) | Receipt schema v3 field reference |
| [Governed execution decisions](docs/governed-execution-decisions.md) | ADR-style design decisions |
| [Working with subagents](docs/WORKING_WITH_SUBAGENTS.md) | Handler integration and code map |

Tests: `governedExecutionLockNecessity.test.ts`, `governedExecutionHardening.test.ts`, `governedExecutionReliability.test.ts`, `governedExecutionIntegration.test.ts`, `governedExecutionClosure.test.ts`, `governedExecutionRoadmapProjection.test.ts`, `governedExecutionRoadmapProjectionHardening.test.ts`, `GovernedReceiptPanel.test.tsx` (**110** contracts via `npm run test:unit -- --grep "governed execution"`).

---

## Plan & Act modes

LUMI runs in **`plan`** or **`act`** mode (`src/shared/storage/types.ts`). Each mode can use a **different provider and model**.

| Mode | Response tool | Behavior |
|------|---------------|----------|
| **Plan** | `plan_mode_respond` | Strategy, exploration, read-only tools |
| **Act** | `act_mode_respond` | Implementation — mutating tools with approval |

Typical flow: gather context in Plan → user approves direction → Act executes writes → `attempt_completion` through completion gates.

Configure independently in **LUMI Settings → API Configuration** (Plan / Act tabs). Guide: [docs/core-workflows/plan-and-act.mdx](docs/core-workflows/plan-and-act.mdx).

---

## Built-in slash commands

Typed at the start of a message (`/command`). Source: `SUPPORTED_DEFAULT_COMMANDS` in `src/core/slash-commands/index.ts`.

| Command | Purpose |
|---------|---------|
| `/newtask` | Start a fresh task context |
| `/compact` | Condense conversation history |
| `/smol` | Shorter context mode |
| `/newrule` | Create a project rule |
| `/reportbug` | Structured bug report flow |
| `/deep-planning` | Extended planning pass |
| `/replan` | Revisit plan after new information |
| `/explain-changes` | Summarize what changed |
| `/document` | Generate documentation for changes |
| `/roadmap` | Roadmap steering actions |

Custom workflows: `.dietcodeworkflows/` · MCP prompts: `/mcp:<server>:<prompt>` · Details: [docs/core-workflows/using-commands.mdx](docs/core-workflows/using-commands.mdx).

---

## Lifecycle hooks

Eight hook kinds in `VALID_HOOK_TYPES` (`src/core/hooks/utils.ts`). Scripts live under **`.dietcoderules/hooks/`** (workspace or global hooks dir).

| Hook | Fires when |
|------|------------|
| `TaskStart` | Task begins |
| `TaskResume` | Task resumes from history |
| `TaskCancel` | Task cancelled |
| `TaskComplete` | Task completes |
| `PreToolUse` | Before a tool executes (can cancel) |
| `PostToolUse` | After a tool executes |
| `UserPromptSubmit` | User sends a message |
| `PreCompact` | Before context compaction |

Guide: [docs/customization/hooks.mdx](docs/customization/hooks.mdx).

---

## Key VS Code settings

Published under **LUMI** in VS Code Settings (`package.json` `contributes.configuration`):

| Setting | Default | Purpose |
|---------|---------|---------|
| `lumi.roadmap.enabled` | `true` | Master switch for ROADMAP.md steering |
| `lumi.roadmap.autoBootstrap` | `true` | Create `ROADMAP.md` from workspace evidence |
| `lumi.roadmap.autoBootstrapFill` | `true` | Autofill roadmap after bootstrap |
| `lumi.roadmap.blockKanbanOnValidationPending` | `true` | Block completion when roadmap changed since validate |
| `lumi.roadmap.failClosedCompletionGates` | `true` | Block completion when gate evaluation fails |

Details: [docs/features/roadmap-steering.mdx](docs/features/roadmap-steering.mdx).

---

## How a task flows

```mermaid
sequenceDiagram
  participant U as You
  participant W as Webview
  participant C as Controller
  participant T as Task loop
  participant L as LLM (4 providers)
  participant H as Tool handlers
  participant V as VS Code host

  U->>W: Message + @ mentions
  W->>C: gRPC / state update
  C->>T: Run agent loop
  T->>L: buildApiHandler stream
  L-->>T: Tool call proposal
  T->>W: Approval card + diff
  U->>W: Approve / Reject
  W->>T: User response
  T->>H: ToolExecutorCoordinator
  H->>V: Host bridge (files, terminal, browser)
  V-->>T: Result
  T->>T: Checkpoint commit (shadow Git)
  T->>L: Next turn until completion gate
```

**Governed swarm branch:** `use_subagents` → pressure admit → orchestration lease → audit preflight → `GovernedSwarmCoordinator` (classify → DAG lanes → acquire → execute → merge gate → seal or crash seal) → `GovernedReceiptPanel` in subagent status row.

Deep dive: [docs/architecture/current.md](docs/architecture/current.md) · [docs/papers/whitepaper.md](docs/papers/whitepaper.md) · [docs/governed-subagent-execution.md](docs/governed-subagent-execution.md).

---

## Trust model

```mermaid
flowchart LR
  A[User intent] --> B[Controller + Task loop]
  B --> C{Mutating tool?}
  C -->|No| D[Execute read-only tool]
  C -->|Yes| E[Approval UI + diff]
  E -->|Reject| B
  E -->|Approve| F[Tool handler]
  F --> G[Host bridge I/O]
  G --> H[Checkpoint snapshot]
  H --> B
  B --> I{attempt_completion}
  I --> J[completionGatePipeline]
  J -->|Pass| K[Task complete]
  J -->|Fail| B
  B --> S{use_subagents swarm?}
  S -->|Yes| M[MergeGate + governed receipt]
  M -->|Pass| K
  M -->|Fail| B
```

Layers: [docs/SECURITY_BEST_PRACTICES.md](docs/SECURITY_BEST_PRACTICES.md) · Hooks · `.dietcodeignore` · roadmap gates · [governed merge gate](docs/governed-subagent-execution.md#3-one-merge-gate-optimistic-reconciliation).

---

## Architecture at a glance

The monorepo ships **two layers**:

```
┌──────────────────────────────────────────────────────────────┐
│  LUMI  ·  CardSorting.lumi  ·  VS Code extension             │
│  Webview ↔ Controller ↔ Task loop ↔ Tools · MCP · Subagents  │
│  GovernedSwarmCoordinator · LockAuthority · MergeGate          │
│  Docs: docs/papers/*  ·  docs/governed-subagent-execution.md │
└────────────────────────────┬─────────────────────────────────┘
                             │ @noorm/broccolidb
┌────────────────────────────▼─────────────────────────────────┐
│  BroccoliDB  ·  capabilities · runtime · snapshots · Spider  │
│  Docs: broccolidb/docs/                                      │
└──────────────────────────────────────────────────────────────┘
```

Canonical map: [docs/AGENT_STACK.md](docs/AGENT_STACK.md).

```mermaid
flowchart TB
  subgraph ext ["LUMI extension"]
    EX[extension.ts]
    WP[webview-ui]
    CT[Controller]
    TK[Task loop]
    TL[ToolExecutorCoordinator]
    GSC[GovernedSwarmCoordinator]
    LA[LockAuthority]
    MG[MergeGate]
    EX --> CT
    WP <--> CT
    CT --> TK
    TK --> TL
    TL --> GSC
    GSC --> LA
    GSC --> MG
    WP --> GRP[GovernedReceiptPanel]
  end
  subgraph host ["VS Code host"]
    HB[hostbridge]
    TL --> HB
  end
  subgraph llm ["LLM layer"]
    API[buildApiHandler]
    TK --> API
  end
  subgraph store ["Local store"]
    BDB["@noorm/broccolidb"]
    CP[checkpoints]
    GR[governed receipts]
    TK --> BDB
    TK --> CP
    GSC --> GR
  end
```

---

## Monorepo packages

| Package | Path | npm | Role |
|---------|------|-----|------|
| **LUMI extension** | repo root | `lumi-vscode` | VS Code agent — `CardSorting.lumi-vscode` / `CardSorting.lumi` |
| **BroccoliDB** | `broccolidb/` | `@noorm/broccolidb` | Context store, runtime, Spider |

npm workspaces in root `package.json`: `"."` and `"broccolidb"`. Install BroccoliDB standalone: [broccolidb/README.md](broccolidb/README.md).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Extension host | TypeScript, VS Code Extension API, esbuild |
| Webview UI | React, Vite |
| IPC | Protobuf / gRPC host bridge (`proto/`) |
| LLM routing | `buildApiHandler` — 4 wired providers |
| Local store | BroccoliDB (`better-sqlite3`), shadow Git checkpoints |
| Governed execution | LockAuthority, MergeGate, receipt schema v3, ReplayValidator |
| Lint / format | Biome |
| Tests | Mocha (unit), `@vscode/test-electron` (integration), Playwright (e2e) |
| Docs site | Mintlify (`docs/`) |

---

## Documentation

| Doc | Description |
|-----|-------------|
| **[docs/README.md](docs/README.md)** | **Documentation hub** — reading paths by audience |
| [Quick start](docs/getting-started/quick-start.mdx) | Install, provider, first task |
| [What is LUMI?](docs/getting-started/what-is-dietcode.mdx) | Product overview |
| [All tools](docs/tools-reference/all-dietcode-tools.mdx) | Full tool enum reference |
| [Agent stack](docs/AGENT_STACK.md) | LUMI session + BroccoliDB substrate |
| [Governed subagent execution](docs/governed-subagent-execution.md) | Lane modes, lock necessity, merge gate, lifecycle |
| [Governed execution runbook](docs/governed-execution-runbook.md) | Operator incident playbook, violation catalog |
| [Governed execution schema](docs/governed-execution-schema.md) | Receipt schema v3 field reference |
| [Governed execution decisions](docs/governed-execution-decisions.md) | ADR-style design decisions |
| [Working with subagents](docs/WORKING_WITH_SUBAGENTS.md) | Subagent handler integration |
| [Architecture (current)](docs/architecture/current.md) | Module map and request flow |
| [Project map](docs/PROJECT_MAP.md) | 1-to-1 `src/` directory guide |
| [Code ↔ docs](docs/CODE_TO_DOC_MAP.md) | Source path → documentation lookup |
| [Security practices](docs/SECURITY_BEST_PRACTICES.md) | Approval gates, ignore files, MCP |
| [Maintainer guide](docs/MAINTAINER.md) | Doc CI, branding, update checklist |
| [Companion brief](docs/papers/companion-brief.md) | Executive summary · measured metrics |
| [Philosophy](docs/papers/philosophy.md) | Design values |
| [Whitepaper](docs/papers/whitepaper.md) | Full technical architecture |
| [BroccoliDB docs](broccolidb/docs/README.md) | Context store (separate package) |
| [Runtime API index](docs/api/README.md) | Agent-facing BroccoliDB capabilities |

**Mintlify preview:** `cd docs && npm install && npm run dev`

---

## Papers

Read in order for depth on **why** and **how** LUMI is built ([full index](docs/papers/README.md)):

| # | Doc | Audience | Time |
|---|-----|----------|------|
| 1 | [Companion brief](docs/papers/companion-brief.md) | Leads, evaluators | ~5 min |
| 2 | [Philosophy](docs/papers/philosophy.md) | Designers, tech leads | ~15 min |
| 3 | [Whitepaper](docs/papers/whitepaper.md) | Engineers | ~45 min |

Substrate papers: [broccolidb/docs/papers/](broccolidb/docs/papers/) — separate narrative.

---

## Repository layout

| Path | Role |
|------|------|
| `src/extension.ts` | VS Code activation entry |
| `src/core/controller/` | `Controller` — task lifecycle, state, MCP, auth |
| `src/core/task/` | Agent loop (~4k lines), message state, tools |
| `src/core/api/` | `buildApiHandler` + 4 wired provider handlers |
| `src/core/task/tools/` | `ToolExecutorCoordinator` + handler files |
| `src/core/task/tools/subagent/` | Subagent runner, `GovernedSwarmCoordinator`, `GovernedIntegration`, `MergeGate`, `LockNecessity` |
| `src/core/governance/` | `LockAuthority`, `governLock`, broccoli fencing adapter |
| `src/shared/subagent/governedExecution.ts` | Receipt schema v3 types and helpers |
| `src/integrations/checkpoints/` | Shadow Git checkpoint system |
| `src/services/mcp/McpHub.ts` | MCP server connections |
| `src/shared/tools.ts` | `DietCodeDefaultTool` enum (63 values) |
| `webview-ui/` | React sidebar — chat, settings, diffs, `GovernedReceiptPanel` |
| `broccolidb/` | BroccoliDB package (`@noorm/broccolidb`) |
| `docs/` | LUMI user and architecture documentation |
| `proto/` | Protobuf schemas (state, host bridge, hooks) |

Full map: [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md).

---

## Development

### Setup

```bash
git clone https://github.com/CardSorting/LUMI.git
cd LUMI
npm run install:all          # root + webview-ui
npm run protos               # required before first build
npm run dev                  # watch extension + typecheck
npm run dev:webview          # separate terminal — webview HMR
```

Press **F5** in VS Code → Extension Development Host with LUMI loaded.

Package VSIX: `npm run package` → install `dist/*.vsix`.

### Scripts reference

| Script | Purpose |
|--------|---------|
| `npm run check-types` | TypeScript — extension + webview |
| `npm run lint` | Biome + proto lint |
| `npm test` | Unit + integration tests |
| `npm run ci:check-all` | Types, lint, format, roadmap audit, **doc guardrails** |
| `npm run docs:check-agent-links` | Required docs + relative link resolution |
| `npm run docs:check-agent-branding` | No stale user-facing DietCode in core dirs |
| `npm run docs:check-all` | All doc guardrails + Mintlify links |
| `npm run docs:check-root-readme` | README parity + live metrics from codebase |
| `npm run docs:check-root-readme-links` | Root README relative link resolution |
| `npm run docs:check-readme-metrics` | README + companion-brief vs live codebase |
| `npm run docs:check-links` | Mintlify broken-link pass |
| `npm run e2e` | Playwright end-to-end tests |

**Governed execution tests:**

```bash
npm run test:unit -- --grep "governed execution"
```

### Quality gates

`npm run ci:check-all` runs these **in parallel**:

| Gate | Script | Validates |
|------|--------|-----------|
| Types | `check-types` | TypeScript — extension + webview |
| Lint | `lint` | Biome + proto lint |
| Format | `format` | Biome format on changed files |
| Roadmap | `roadmap:audit` | ROADMAP.md consistency |
| Doc links | `docs:check-agent-links` | 24 required docs + link resolution |
| Doc branding | `docs:check-agent-branding` | No stale user-facing DietCode |
| Root README | `docs:check-root-readme` | Parity + live metrics from codebase |
| README links | `docs:check-root-readme-links` | All relative links in README resolve |
| README metrics | `docs:check-readme-metrics` | README + companion-brief vs codebase |
| Docs hub | `docs:check-docs-readme` | `docs/README.md` structure |

Run all doc checks: **`npm run docs:check-all`** (includes Mintlify link pass).

### Documentation guardrails

Doc checks run in `ci:check-all`. When you change tools, providers, governed execution, or architecture, update docs per [docs/MAINTAINER.md](docs/MAINTAINER.md) and [docs/CODE_TO_DOC_MAP.md](docs/CODE_TO_DOC_MAP.md).

Full contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension missing from sidebar | Install **CardSorting.lumi-vscode** or **CardSorting.lumi**; disable DietCode forks; `Developer: Reload Window` |
| Checkpoints fail / “Git must be installed” | Install Git; ensure `git` is on `PATH` |
| Slow on large repos | Add [`.dietcodeignore`](docs/customization/dietcodeignore.mdx); disable checkpoints temporarily |
| Provider auth errors | Re-open LUMI Settings → re-enter API key or re-auth OAuth provider |
| MCP server won't connect | Check [MCP config](docs/mcp/adding-and-configuring-servers.mdx); verify server logs in Output panel |
| Completion blocked unexpectedly | Run `/roadmap validate`; check `lumi.roadmap.*` settings |
| Subagent merge blocked | Open incident console — check patches rejected, `unsafe mutation overlap`, or `commit: blocked`; see [runbook](docs/governed-execution-runbook.md) |
| Roadmap not updated after swarm | Check `commit: committed` in incident console — lanes must use `[propose_patch:…]`; see [quick reference](docs/governed-roadmap-projection-quickref.md) |
| “Lock skipped” on read lane | Expected — not a missing lock; see [governed execution](docs/governed-subagent-execution.md) |
| Retry unsafe after swarm fail | Check `diagnostics.retrySafe`; recover stale claims on mutation lanes |
| Build fails from source | Run `npm run protos` before first `npm run dev`; use Node **20+** |
| Reset extension state | Close VS Code; remove `~/.dietcode/data/` (backs up secrets/settings); reload window |
| Uninstall cleanly | Uninstall extension; optionally delete `~/.dietcode/data/` and workspace `dietcode.db` |

---

## Getting help

| Channel | Link |
|---------|------|
| **Documentation hub** | [docs/README.md](docs/README.md) |
| **Support guide** | [.github/SUPPORT.md](.github/SUPPORT.md) |
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |
| **Governance** | [GOVERNANCE.md](GOVERNANCE.md) |
| **Discussions** | [GitHub Discussions](https://github.com/CardSorting/LUMI/discussions) |
| **Governed swarm quick ref** | [docs/governed-roadmap-projection-quickref.md](docs/governed-roadmap-projection-quickref.md) |
| **Governed swarm runbook** | [docs/governed-execution-runbook.md](docs/governed-execution-runbook.md) |
| **Glossary** | [docs/getting-started/glossary.mdx](docs/getting-started/glossary.mdx) |
| **Bug reports** | [GitHub Issues](https://github.com/CardSorting/LUMI/issues/new?template=bug_report.yml) |
| **Security (private)** | [SECURITY.md](SECURITY.md) → security@dietcode.bot |
| **Walkthrough** | Command palette → `LUMI: Open Walkthrough` (`lumi.openWalkthrough`) |

Include VS Code version, LUMI **2.1.0**, provider used, and steps to reproduce.

---

## Security & trust

| Boundary | Enforcement |
|----------|-------------|
| **No silent writes** | Tool approval + diff view before files change |
| **Scoped context** | `.dietcodeignore` → `DietCodeIgnoreController` |
| **Completion gates** | `completionGatePipeline.ts` before task finish |
| **Hook interception** | 8 lifecycle hook kinds on tool/session events |
| **MCP isolation** | Per-server credentials; per-tool auto-approve lists |
| **Roadmap fail-closed** | `lumi.roadmap.failClosedCompletionGates` setting |
| **Governed mutation locks** | `LockAuthority` — layered lease + fencing token; fail-closed partial acquire |
| **Swarm merge gate** | Write-set + patch reconciliation before workspace commit; coordinator-only kanban writes |

Details: [docs/SECURITY_BEST_PRACTICES.md](docs/SECURITY_BEST_PRACTICES.md) · [governed execution](docs/governed-subagent-execution.md) · Report vulnerabilities: [SECURITY.md](SECURITY.md) → security@dietcode.bot

---

## FAQ

<details>
<summary><strong>LUMI vs BroccoliDB — what's the difference?</strong></summary>

**LUMI** is the VS Code extension you interact with (chat, approval, tools). **BroccoliDB** is the local substrate package for durable context, runtime graph, and Spider structural proof. They integrate via `@noorm/broccolidb` but have separate docs. See [docs/AGENT_STACK.md](docs/AGENT_STACK.md).
</details>

<details>
<summary><strong>What are governed swarms and lock-skipped lanes?</strong></summary>

When you run parallel subagents (`use_subagents`), each lane declares an **execution mode**. Read lanes skip file locks; workspace roadmap changes flow through **propose_patch** and coordinator commit — not direct kanban writes. See [quick reference](docs/governed-roadmap-projection-quickref.md) and [governed-subagent-execution.md](docs/governed-subagent-execution.md).
</details>

<details>
<summary><strong>Why does the code say "DietCode"?</strong></summary>

**LUMI** is the user-facing product name. Internal types and paths retain the `DietCode` prefix (`DietCodeMessage`, `.dietcoderules/`, `.dietcodeignore`) for historical compatibility. Docs use **LUMI** for product behavior.
</details>

<details>
<summary><strong>Checkpoints are slow on a large repo — what do I do?</strong></summary>

Disable checkpoints in LUMI Settings → Feature Settings → **Enable Checkpoints**, or add a thorough [`.dietcodeignore`](docs/customization/dietcodeignore.mdx). Checkpoints use a shadow Git repo under extension global storage.
</details>

<details>
<summary><strong>Can I use Anthropic / Gemini / Ollama directly?</strong></summary>

Not in this build's wired provider list. Use **OpenRouter** as a gateway, or see legacy reference pages under `docs/provider-config/` (handlers exist but are not wired in `buildApiHandler`).
</details>

<details>
<summary><strong>Where do I add a new tool?</strong></summary>

1. `src/shared/tools.ts` — enum value<br>
2. `src/core/task/tools/handlers/` — handler<br>
3. `ToolExecutorCoordinator.toolHandlersMap` — registration<br>
4. [docs/tools-reference/all-dietcode-tools.mdx](docs/tools-reference/all-dietcode-tools.mdx) — documentation
</details>

<details>
<summary><strong>Extension doesn't appear after install?</strong></summary>

Search for **CardSorting.lumi-vscode** (VS Marketplace) or **CardSorting.lumi** (Open VSX) — not "DietCode". Disable conflicting forks (`dreambeesai.dietcode`, `dietcode.dietcode`). Reload the window (`Developer: Reload Window`).
</details>

<details>
<summary><strong>Where is the authoritative swarm receipt after a failed retry?</strong></summary>

Not necessarily `{swarmId}.governed.json` (latest pointer). Walk `{swarmId}.governed.history.jsonl` for the last `sealed && mergePassed` entry, or use `loadAuthoritativeGovernedReceipt()`. See [governed-execution-runbook.md](docs/governed-execution-runbook.md#authoritative-state-procedure).
</details>

---

## Contributing

We welcome bug fixes, features, and documentation improvements.

| Resource | Link |
|----------|------|
| Contributing guide | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Code of conduct | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| Governance | [GOVERNANCE.md](GOVERNANCE.md) |
| Doc maintainer guide | [docs/MAINTAINER.md](docs/MAINTAINER.md) |
| Documentation map | [docs/DOCS_GUIDE.md](docs/DOCS_GUIDE.md) |
| Code of conduct | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| Issues | [GitHub Issues](https://github.com/CardSorting/LUMI/issues) |

Before a feature PR: open an issue or discussion for maintainer approval. Run `npm run ci:check-all` locally.

---

## License

[Apache-2.0](LICENSE) · Copyright DietCode Inc.
