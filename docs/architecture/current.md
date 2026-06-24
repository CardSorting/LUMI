# Architecture (current)

This document describes the **LUMI agent workspace** as it exists in this repository. BroccoliDB architecture is documented separately in [broccolidb/docs/architecture/current.md](../../broccolidb/docs/architecture/current.md).

## Overview

LUMI is a VS Code extension (`CardSorting.lumi`) composed of:

| Part | Path | Role |
|------|------|------|
| Extension host | `src/` | Agent loop, tools, providers, storage |
| Webview UI | `webview-ui/` | React sidebar (chat, settings, MCP) |
| Context store | `broccolidb/` | SQLite-backed task/context persistence (workspace package) |
| Protocol | `proto/` | Protobuf definitions for host bridge & state |

## Request flow

```
src/extension.ts
    → HostProvider (src/hosts/host-provider.ts)
    → WebviewProvider (src/core/webview/)
    → Controller (src/core/controller/index.ts)
    → Task (src/core/task/index.ts)
        → buildApiHandler (src/core/api/index.ts)  → LLM stream
        → ToolExecutorCoordinator (src/core/task/tools/ToolExecutorCoordinator.ts)
        → HostProvider.hostBridge (file/terminal/window gRPC)
```

1. **Activation** — `src/extension.ts` registers commands, webview, roadmap watcher, and initializes `HostProvider` with VS Code–specific implementations under `src/hosts/vscode/`.
2. **Controller** — Holds extension state, MCP hub, auth, workspace manager, and the active `Task`. Routes webview messages via gRPC handlers in `src/core/controller/`.
3. **Task** — Runs the agent loop: build prompt → call API → parse assistant message → execute tools → repeat until completion or user cancel.
4. **Tools** — Registered in `ToolExecutorCoordinator` against `DietCodeDefaultTool` enum values in `src/shared/tools.ts`.
5. **UI** — `webview-ui/` renders messages; updates arrive through protobuf-backed subscriptions in `src/core/controller/ui/`.

## `src/` directory map

| Directory | Role |
|-----------|------|
| `src/core/controller/` | Webview message handling, task lifecycle, MCP, models, account |
| `src/core/task/` | Agent loop, tool execution, message state |
| `src/core/task/tools/subagent/` | Subagent runner, governed coordinator, projection, merge gate |
| `src/core/governance/` | `LockAuthority`, governed locks, broccoli fencing |
| `src/core/task/tools/` | Tool handlers and coordinator |
| `src/core/api/` | LLM provider handlers and streaming transforms |
| `src/core/context/` | Context window, file tracking, user rules |
| `src/core/prompts/` | System prompts, slash-command templates |
| `src/core/hooks/` | Lifecycle hooks (PreToolUse, PostToolUse, etc.) |
| `src/core/storage/` | StateManager, disk persistence, remote config |
| `src/core/workspace/` | Multi-root workspace detection and resolution |
| `src/core/policy/` | Spider engine integration for structural audit |
| `src/core/integrity/` | In-extension integrity helpers |
| `src/core/slash-commands/` | Built-in `/newtask`, `/compact`, `/roadmap`, etc. |
| `src/hosts/` | Host abstraction; `vscode/` is the only full implementation |
| `src/integrations/` | Checkpoints, terminal, editor diff, browser adapters |
| `src/services/` | MCP, browser, telemetry, tree-sitter, roadmap, auth |
| `src/infrastructure/` | DB pool, AI orchestrator, plumbing |
| `src/shared/` | Types, proto conversions, tools enum, storage keys |
| `src/integrity/` | Stability monitor, audit recorder (top-level) |
| `src/domain/` | Import resolution utilities |
| `src/generated/` | Generated gRPC/protobuf TypeScript |

## LLM providers (wired)

The settings UI reads `src/shared/providers/providers.json`. **`buildApiHandler`** in `src/core/api/index.ts` routes only these providers:

| Provider key | Handler | Label |
|--------------|---------|-------|
| `openrouter` | `OpenRouterHandler` | OpenRouter (default) |
| `openai-codex` | `OpenAiCodexHandler` | ChatGPT Subscription |
| `nousResearch` | `NousResearchHandler` | NousResearch |
| `cloudflare` | `CloudflareHandler` | Cloudflare Workers AI |

Additional handler files exist under `src/core/api/providers/` for other backends; they are not registered in `buildApiHandler` in this build. Plan and Act modes can use different providers (`planModeApiProvider` / `actModeApiProvider`).

## Agent tools

Tools are defined by `DietCodeDefaultTool` in `src/shared/tools.ts` and executed via handlers in `src/core/task/tools/handlers/`. Categories include:

- **File I/O** — `read_file`, `write_to_file`, `replace_in_file`, `search_files`, `list_files`, `apply_patch`
- **Terminal** — `execute_command`
- **Browser & web** — `browser_action`, `web_fetch`, `web_search`
- **MCP** — `use_mcp_tool`, `access_mcp_resource`, `load_mcp_documentation`
- **Modes** — `plan_mode_respond`, `act_mode_respond`, `attempt_completion`
- **Memory graph** — `query_cognitive_memory`, `mem_*` family
- **Stability** — `diagnose_stability`, `scaffold_module`, `query_stability`, etc.
- **Roadmap** — `roadmap`, `roadmap_checkpoint`
- **Subagents** — `use_subagents` (+ dynamically registered subagent tools)
- **Kernel** — `dietcode_kernel` (BroccoliDB runtime bridge)

See [All tools](../tools-reference/all-dietcode-tools.mdx) for the full list.

## Communication layers

| Layer | Mechanism | Location |
|-------|-----------|----------|
| Webview ↔ extension | Protobuf over webview message passing; persistent `subscribeTo*` streams use [subscription runtime](../grpc-subscription-persistence.md) | `src/core/controller/grpc-*`, `src/shared/grpc/persistent-stream.ts`, `webview-ui/src/services/grpc-subscription-runtime.ts` |
| Extension ↔ VS Code | Host bridge gRPC client | `src/hosts/vscode/hostbridge/` |
| Extension ↔ LLM | Provider-specific HTTP/SSE | `src/core/api/providers/` |
| Extension ↔ MCP | MCP SDK transports | `src/services/mcp/` |

Details: [System communication](../SYSTEM_COMMUNICATION.md).

## Configuration

| Source | Examples |
|--------|----------|
| VS Code settings | `lumi.roadmap.enabled`, `lumi.roadmap.autoBootstrap` (`package.json`) |
| Extension state | `src/shared/storage/state-keys.ts` (API keys, toggles, history) |
| Project rules | `.dietcoderules/`, `.cursor/rules`, `.agents/skills/` |
| Ignore patterns | `.dietcodeignore` via `src/core/ignore/` |

## Related packages

- **`@noorm/broccolidb`** — Workspace dependency; powers cognitive memory, Spider audit, and local SQLite storage.
- **`evals/`** — Benchmark and E2E evaluation harness (not part of the shipped extension).

---

## Two layers in the monorepo

| Layer | Question | Documentation |
|-------|----------|---------------|
| **LUMI** (this doc) | How does the sidebar session work? | [Papers](../papers/README.md) · [Project map](../PROJECT_MAP.md) |
| **BroccoliDB** | What happened to the repository structurally? | [Substrate architecture](../../broccolidb/docs/architecture/current.md) · [Substrate papers](../../broccolidb/docs/papers/philosophy.md) |

LUMI owns approval, LLM loop, webview, and VS Code I/O. BroccoliDB owns proof, repair executor, runtime graph, and snapshots. Integration is via tool handlers and `@noorm/broccolidb` — not by merging the codebases.

---

## Safety pipeline (summary)

```
Tool proposed → PreToolUse hook (optional)
            → User approve / auto-approve rule
            → Execute via HostProvider or MCP
            → PostToolUse hook (optional)
attempt_completion → completionGatePipeline (audit, roadmap, focus chain)
use_subagents seal   → MergeGate → patch reconciliation → coordinator workspace commit
```

Details: [Security best practices](../SECURITY_BEST_PRACTICES.md) · [Whitepaper §7](../papers/whitepaper.md#7-approval-hooks-and-completion) · [Roadmap projection quick reference](../governed-roadmap-projection-quickref.md).

---

## Deep dives

| Topic | Doc |
|-------|-----|
| Executive metrics | [Companion brief](../papers/companion-brief.md) |
| Design values | [Philosophy](../papers/philosophy.md) |
| Full technical spec | [Whitepaper](../papers/whitepaper.md) |
| Governed swarms | [Governed subagent execution](../governed-subagent-execution.md) |
| Roadmap projection (quick) | [Quick reference](../governed-roadmap-projection-quickref.md) |
| Runtime API (substrate) | [api/README.md](../api/README.md) |
| IPC & host bridge | [System communication](../SYSTEM_COMMUNICATION.md) |
