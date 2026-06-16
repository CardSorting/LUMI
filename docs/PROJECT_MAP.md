---
title: "Project Map & Architecture"
sidebarTitle: "Project Map"
description: "A literal guide to the LUMI codebase structure and how modules connect."
---

# Project Map & Architecture

This map reflects the **actual** layout of the LUMI agent workspace. Paths are relative to the repository root.

## Workspace overview

| Directory | Role |
|-----------|------|
| **`src/extension.ts`** | VS Code activation: commands, webview, migrations, roadmap watcher |
| **`src/core/controller/`** | `Controller` class — task lifecycle, state, MCP, auth, gRPC handlers |
| **`src/core/task/`** | Agent loop (`Task`), message state, tool orchestration |
| **`src/core/task/tools/`** | `ToolExecutorCoordinator` + per-tool handlers |
| **`src/core/api/`** | `buildApiHandler`, provider handlers, stream transforms |
| **`src/core/context/`** | Context window management, file/env tracking, user rules |
| **`src/core/prompts/`** | System prompt variants and slash-command response templates |
| **`src/core/hooks/`** | Hook discovery, factory, and execution |
| **`src/core/storage/`** | `StateManager`, disk I/O, remote config fetch |
| **`src/core/workspace/`** | Multi-root detection, `WorkspaceRootManager` |
| **`src/core/policy/spider/`** | Spider forensic engine integration |
| **`src/core/webview/`** | Webview provider abstraction |
| **`src/hosts/vscode/`** | VS Code host bridge, diff view, terminal, review comments |
| **`src/hosts/host-provider.ts`** | Singleton injecting host-specific factories |
| **`src/integrations/`** | Checkpoints, terminal interface, editor diff, notifications |
| **`src/services/`** | MCP hub, browser session, telemetry, tree-sitter, roadmap, auth |
| **`src/infrastructure/`** | DB pool, orchestrator, plumbing |
| **`src/shared/`** | Shared types, proto conversions, `DietCodeDefaultTool` enum |
| **`src/integrity/`** | Stability monitor, audit recorder, handover |
| **`src/domain/`** | Import resolution (`import-resolution/`) |
| **`webview-ui/`** | React sidebar — chat, settings, MCP configuration |
| **`broccolidb/`** | Context store package (documented separately) |
| **`proto/`** | Protobuf schemas for state, host bridge, hooks |

## Core flow

```
extension.ts
  └─ HostProvider.initialize(...)
  └─ WebviewProvider (VscodeWebviewProvider)
       └─ Controller (src/core/controller/index.ts)
            └─ Task (src/core/task/index.ts)
                 ├─ buildApiHandler() → LLM
                 ├─ parseSlashCommands() / parseMentions()
                 └─ ToolExecutorCoordinator.execute()
                      └─ handlers/*ToolHandler.ts
```

There is **no** `DietCodeController.ts`. The main controller is **`Controller`** in `src/core/controller/index.ts`.

There is **no** `src/infrastructure/tools/` registry. Tools live in **`src/core/task/tools/`**.

Provider handlers are in **`src/core/api/providers/`**, not `src/services/providers/`.

## Key files

| Concern | File |
|---------|------|
| Extension entry | `src/extension.ts` |
| Command ID prefix | `src/registry.ts` (`lumi.*` when `package.json` name is `lumi`) |
| Tool enum | `src/shared/tools.ts` |
| Tool routing | `src/core/task/tools/ToolExecutorCoordinator.ts` |
| Provider routing | `src/core/api/index.ts` → `createHandlerForProvider` |
| Provider list (UI) | `src/shared/providers/providers.json` |
| State keys | `src/shared/storage/state-keys.ts` |
| Slash commands | `src/core/slash-commands/index.ts` |
| System prompts | `src/core/prompts/system-prompt/` |
| Package metadata | `package.json` (name: `lumi`, publisher: `CardSorting`) |

## Architectural patterns

### Host abstraction

`HostProvider` decouples core logic from VS Code. The extension initializes it with VS Code–specific webview, diff, terminal, and gRPC bridge implementations. Core code calls `HostProvider.get()` instead of importing `vscode` directly.

### Human-in-the-loop

Tools that mutate the workspace (`write_to_file`, `execute_command`, etc.) flow through approval UI in the webview. Read-only tools (`READ_ONLY_TOOLS` in `src/shared/tools.ts`) can run without blocking on checkpoint commits.

### BroccoliDB integration

The agent uses `@noorm/broccolidb` for cognitive memory tools, Spider audit, and SQLite persistence. Agent-side wiring is in tool handlers (`CognitiveMemory*Handler`, `DietcodeKernelToolHandler`) and `src/infrastructure/db/`.

### Plan vs Act

Separate API providers and prompts per mode (`planModeApiProvider` / `actModeApiProvider`). Plan mode uses `plan_mode_respond`; Act mode uses `act_mode_respond` and mutating tools.

## What lives outside `src/`

| Path | Role |
|------|------|
| `walkthrough/` | VS Code walkthrough markdown steps |
| `assets/icons/` | Extension icons and orb mark font |
| `.dietcoderules/` | Default workflows and agent rules for this repo |
| `.agents/skills/` | Cursor agent skills |
| `evals/` | Evaluation benchmarks and analysis |
| `docs/` | This documentation site (Mintlify) |

## Further reading

- [Architecture (current)](architecture/current.md)
- [System communication](SYSTEM_COMMUNICATION.md)
- [BroccoliDB docs](../broccolidb/docs/README.md)
