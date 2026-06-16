# LUMI Technical Whitepaper

**Version 1.0.3 — Calm Agent Extension**

*A coding companion is not finished until you can keep it open all day without feeling managed by it.*

**Extension:** `CardSorting.lumi` · **Package name:** `lumi` · **Repository:** agent workspace in the codemarie-new monorepo (`src/`, `webview-ui/`)

---

## Abstract

LUMI is a VS Code extension that implements an agentic pair programmer: natural-language tasks, LLM-driven tool use, file and terminal access, browser automation, MCP integration, and optional subagent delegation — with **human-in-the-loop approval** on mutating actions and **gated task completion**.

The system composes four major parts:

1. **Extension host** (`src/`) — controller, task loop, tools, providers, hooks, storage
2. **Webview UI** (`webview-ui/`) — React sidebar for chat, settings, diffs, and approval UX
3. **Host bridge** (`src/hosts/vscode/hostbridge/`) — gRPC/protobuf adapter to VS Code APIs
4. **BroccoliDB** (`@noorm/broccolidb`) — cognitive memory, Spider structural audit, runtime kernel

This whitepaper is grounded in the implementation as it exists in the workspace: file paths, enums, provider wiring, and pipeline order cited here are verifiable in the tree.

---

## 1. The problem

### 1.1 Agents in the editor without session discipline

Coding agents promise speed. They risk **opacity** — changes appear without context, commands run without consent, sessions end without verification. Developers need:

| Session question | Without LUMI-like discipline | With LUMI |
|------------------|---------------------------|-----------|
| What is the agent about to do? | Opaque tool stream | Visible tool cards + parameters |
| Can I stop a bad edit? | Maybe undo in git | Approve/reject before write |
| Did it actually finish the task? | Model says "done" | `attempt_completion` + gate pipeline |
| Can I plan before code lands? | Mixed read/write | Plan mode + `plan_mode_respond` |
| What happened yesterday? | Chat scrollback | Task history + BroccoliDB memory |

### 1.2 What this workspace implements

| Artifact | Count / location |
|----------|------------------|
| Extension version | **1.0.3** — `package.json` |
| Static tool enum values | **62** — `src/shared/tools.ts` |
| Tool handler implementations | **55** files — `src/core/task/tools/handlers/` |
| Wired LLM providers | **4** — `src/shared/providers/providers.json` + `src/core/api/index.ts` |
| Lifecycle hook kinds | **8** — `src/core/hooks/hook-factory.ts` |
| Built-in slash commands | **10** — `src/core/slash-commands/index.ts` |
| VS Code commands (`lumi.*`) | **~25** — `package.json` |
| Test files under `src/` | **~190** |

BroccoliDB substrate metrics (69 test files, 12 capabilities, etc.) are documented in [broccolidb/docs/papers/whitepaper.md](../../broccolidb/docs/papers/whitepaper.md).

---

## 2. Design principles

These are observable in code, not merely documented:

1. **Human-in-the-loop default** — Mutating tools flow through approval UI; `READ_ONLY_TOOLS` (13 entries) is an explicit allowlist for non-blocking exploration.

2. **Typed tool routing** — Every agent capability maps to `DietCodeDefaultTool` and a handler registered in `ToolExecutorCoordinator.toolHandlersMap`.

3. **Host abstraction** — Core logic uses `HostProvider`; only `src/hosts/vscode/` imports VS Code APIs directly.

4. **Plan/Act partition** — Separate providers, models, and response tools per mode (`plan_mode_respond` vs `act_mode_respond`).

5. **Completion is gated** — `AttemptCompletionHandler` invokes `completionGatePipeline.ts` (audit, roadmap, focus chain, quality checks).

6. **Comfort without hiding** — Webview UX (`LUMI_UX.md`) optimizes tone and visual calm; it does not remove diffs or approval prompts.

7. **Substrate separation** — Repository proof and durable graph truth live in BroccoliDB; LUMI integrates via tools and policy, not by reimplementing substrate.

8. **Explicit extension** — MCP, hooks, skills, workflows, and subagents attach to tool contracts; they do not receive raw filesystem access.

---

## 3. Architectural model

### 3.1 Request flow (implemented)

```
src/extension.ts
  → HostProvider.initialize(VscodeWebviewProvider, VscodeDiffViewProvider, …)
  → WebviewProvider
  → Controller (src/core/controller/index.ts)
  → Task (src/core/task/index.ts)
      → ContextManager + rules + mentions + slash commands
      → buildApiHandler(mode) → ApiHandler.createMessage/stream
      → parseAssistantMessageV2 → ToolUse[]
      → ToolExecutorCoordinator.executeTool()
      → HostProvider.hostBridge | McpHub | BrowserSession | BroccoliDB handlers
```

**Controller** holds: active `Task`, `McpHub`, auth services, `StateManager`, optional `WorkspaceRootManager`, remote config timer.

**Task** (~4,100 lines) orchestrates: streaming, tool execution, checkpoint integration, hook execution, mode transitions, cancellation, telemetry.

There is no `DietCodeController.ts`. The entry class is **`Controller`**.

### 3.2 Communication layers

| Layer | Mechanism | Location |
|-------|-----------|----------|
| Webview ↔ extension | Protobuf messages | `src/core/controller/grpc-*`, `src/shared/proto/` |
| Extension ↔ VS Code | gRPC host bridge | `src/hosts/vscode/hostbridge/` |
| Extension ↔ LLM | Provider HTTP/SSE | `src/core/api/providers/` |
| Extension ↔ MCP | MCP SDK | `src/services/mcp/McpHub.ts` |

Generated code: `npm run protos` → `src/generated/`.

### 3.3 Module map (agent workspace)

| Directory | Role |
|-----------|------|
| `src/core/controller/` | gRPC handlers, task lifecycle, MCP UI, models |
| `src/core/task/` | Agent loop, message state |
| `src/core/task/tools/` | Coordinator + handlers + completion gates |
| `src/core/api/` | Providers + stream transforms |
| `src/core/context/` | Context window, file tracking, rules |
| `src/core/hooks/` | Hook discovery, factory, execution |
| `src/core/storage/` | StateManager, disk, remote config |
| `src/core/policy/spider/` | Spider engine integration |
| `src/core/slash-commands/` | Built-in `/newtask`, `/roadmap`, etc. |
| `src/hosts/vscode/` | VS Code-specific adapters |
| `src/integrations/` | Checkpoints, terminal, diff, notifications |
| `src/services/` | Browser, telemetry, tree-sitter, roadmap, auth |
| `src/infrastructure/` | DB pool, orchestrator |
| `webview-ui/` | React sidebar |

Full map: [PROJECT_MAP.md](../PROJECT_MAP.md).

---

## 4. The task loop

### 4.1 Input processing

User messages pass through:

1. **`parseMentions`** (`src/core/mentions/`) — `@file`, `@folder`, `@url`, terminal, git, problems
2. **`parseSlashCommands`** (`src/core/slash-commands/index.ts`) — built-in commands + workflow files + MCP prompts
3. **Rules injection** — `.dietcoderules/`, Cursor/Windsurf rules, global rules from `StateManager`
4. **Context assembly** — `ContextManager`, file/env/model trackers

Built-in slash commands (verified):

`newtask`, `smol`, `compact`, `newrule`, `reportbug`, `deep-planning`, `replan`, `explain-changes`, `document`, `roadmap`

### 4.2 LLM interaction

`buildApiHandler(configuration, mode)` in `src/core/api/index.ts`:

- Selects `planModeApiProvider` or `actModeApiProvider`
- Instantiates one of four handlers (see §5)
- Falls back to OpenRouter on unknown provider or handler creation failure
- Streams via provider-specific transforms (`src/core/api/transform/`)

Tool calls may be native (model API tools) or parsed from text (`parseAssistantMessageV2`), depending on `isNativeToolCallingConfig`.

### 4.3 Tool execution

`ToolExecutorCoordinator`:

- Maps `DietCodeDefaultTool` → handler factory
- Supports **dynamic subagent handlers** (`dynamicSubagentHandlers` map)
- Validates via `ToolValidator`
- Runs hook pipeline (`ToolHookUtils`, `hook-executor.ts`) when hooks enabled
- Returns structured `ToolResponse` to conversation

Unwired enum entries (`rename_files`, `move_files`, `delete_file`, `focus_chain` as TODO handler) return `undefined` from factory — coordinator must handle absence.

### 4.4 Checkpoints

`src/integrations/checkpoints/` — snapshot workspace during tasks; coordinates with read-only tool allowlist so exploration does not block on checkpoint commits.

---

## 5. LLM providers

### 5.1 Wired in this build

`src/shared/providers/providers.json` and `createHandlerForProvider`:

| Provider key | Handler class | Notes |
|--------------|---------------|-------|
| `openrouter` | `OpenRouterHandler` | Default; broad model catalog |
| `openai-codex` | `OpenAiCodexHandler` | ChatGPT subscription flow |
| `nousResearch` | `NousResearchHandler` | NousResearch API |
| `cloudflare` | `CloudflareHandler` | Workers AI |

### 5.2 Present but unwired

**45** handler files exist under `src/core/api/providers/` (Anthropic, Ollama, Bedrock, Gemini, …). Matching settings components exist in `webview-ui/src/components/settings/providers/`. They are **not** registered in `buildApiHandler` in this build — enabling them requires extending `createHandlerForProvider` and `providers.json`.

`ApiProvider` union in `src/shared/api.ts` lists intended providers for type compatibility across the codebase.

---

## 6. Tool surface

### 6.1 Categories

| Category | Tool names (sample) | Handler location |
|----------|---------------------|------------------|
| File I/O | `read_file`, `write_to_file`, `replace_in_file`, `search_files`, `apply_patch` | `*FileToolHandler`, `ApplyPatchHandler` |
| Terminal | `execute_command` | `ExecuteCommandToolHandler` |
| Browser / web | `browser_action`, `web_fetch`, `web_search` | `BrowserToolHandler`, `Web*ToolHandler` |
| MCP | `use_mcp_tool`, `access_mcp_resource`, `load_mcp_documentation` | `UseMcpToolHandler`, etc. |
| Modes | `plan_mode_respond`, `act_mode_respond` | `PlanModeRespondHandler`, `ActModeRespondHandler` |
| Task control | `attempt_completion`, `new_task`, `condense`, `summarize_task` | `AttemptCompletionHandler`, … |
| Cognitive memory | `query_cognitive_memory`, `mem_*` (21 tools) | `CognitiveMemory*Handler` |
| Stability | `diagnose_stability`, `scaffold_module`, `ast_repair`, … | `Stability*Handler`, `Module*Handler` |
| Roadmap | `roadmap`, `roadmap_checkpoint` | `RoadmapToolHandler` |
| Kernel | `dietcode_kernel` | `DietcodeKernelToolHandler` |
| Subagents | `use_subagents` + dynamic names | `SubagentToolHandler`, `SubagentRunner` |

Complete enum: `src/shared/tools.ts`. Reference: [all-dietcode-tools.mdx](../tools-reference/all-dietcode-tools.mdx).

### 6.2 Read-only tools

These may run without blocking initial checkpoint commit (`READ_ONLY_TOOLS`):

`list_files`, `read_file`, `search_files`, `list_code_definition_names`, `browser_action`, `ask_followup_question`, `web_search`, `web_fetch`, `use_skill`, `project_map`, `use_subagents`, `diagnose_stability`

---

## 7. Approval, hooks, and completion

### 7.1 Approval

- Webview presents tool uses; user approves or rejects
- `src/core/task/tools/autoApprove.ts` — rule-based auto-approval
- Diff view via `HostProvider.createDiffViewProvider()` — `VscodeDiffViewProvider`

### 7.2 Hooks (8 kinds)

Defined in `src/core/hooks/hook-factory.ts` `Hooks` interface:

| Hook | When |
|------|------|
| `PreToolUse` | Before tool execution |
| `PostToolUse` | After tool execution |
| `UserPromptSubmit` | Before prompt sent to model |
| `TaskStart` | Task begins |
| `TaskResume` | Task resumed |
| `TaskCancel` | Task cancelled |
| `TaskComplete` | Task completes |
| `PreCompact` | Before context compaction |

Hooks run as scripts in `.dietcoderules/hooks/` (and global hooks dir). Output can `cancel`, add `contextModification`, or set `errorMessage`. Timeout: 30s (`HOOK_EXECUTION_TIMEOUT_MS`).

### 7.3 Completion gate pipeline

`attempt_completion` triggers `completionGatePipeline.ts`, which coordinates:

- Workspace audit policy (`auditGatePolicyLoader`)
- Plan baseline alignment (`getLatestPlanAuditFromMessages`)
- Pre-completion checklist
- Roadmap gate (`RoadmapCompletionGate`, `lumi.roadmap.failClosedCompletionGates`)
- Focus chain validation
- Result quality, length, cooldown, circuit breaker (`attemptCompletionUtils.ts`)

Failure returns structured guidance to the model — completion is **not** accepted until gates pass.

---

## 8. Subagents and orchestration

### 8.1 Subagents

- Entry: `use_subagents` tool → `SubagentToolHandler`
- Runtime: `SubagentRunner`, `SubagentBuilder`, `AgentConfigLoader`
- Dynamic tool registration per subagent config
- Completion gates: `subagentCompletionGates.ts`
- Swarm: `SwarmConsensusHandler`, shared memory tools (`mem_claim`, `mem_release`, `mem_hubs`)

Subagents inherit parent approval and hook settings.

### 8.2 Orchestrator

`src/infrastructure/ai/Orchestrator.ts` — tracks agent streams, subagent tasks, intent classification (`REFACTOR`, `DEBUG`, …), audit metadata, swarm signals. Persists via `src/infrastructure/db/BufferedDbPool`.

---

## 9. BroccoliDB integration

LUMI depends on `@noorm/broccolidb` (workspace package). Integration points:

| Concern | Agent-side location |
|---------|---------------------|
| Cognitive memory tools | `CognitiveMemory*Handler` |
| Runtime kernel | `DietcodeKernelToolHandler` |
| Spider policy | `src/core/policy/spider/SpiderEngine` |
| DB pool | `src/infrastructure/db/BufferedDbPool` |

**Division of responsibility:**

- LUMI: session UX, tool approval, LLM loop, VS Code I/O
- BroccoliDB: structural proof, governed repair, runtime graph, snapshots, replay

Do not duplicate BroccoliDB architecture here — see [broccolidb/docs/papers/whitepaper.md](../../broccolidb/docs/papers/whitepaper.md).

---

## 10. Webview and UX

### 10.1 Stack

- **Framework:** React + Vite (`webview-ui/`)
- **Messaging:** Protobuf-backed state subscriptions from controller
- **Voice/copy:** `webview-ui/src/copy/lumiVoice.ts`
- **Comfort:** `useLumiSessionComfort.ts`, `LumiAmbientOrb.tsx`

### 10.2 North star

From `webview-ui/docs/LUMI_UX.md`:

> Can someone keep this open all day without feeling managed by it?

Product name in UI: **LUMI**. Internal types retain `DietCode` prefix (e.g. `DietCodeMessage`) — intentional separation of user-facing brand from legacy type names.

---

## 11. Configuration and customization

| Mechanism | Path / key |
|-----------|------------|
| VS Code settings | `lumi.roadmap.*` in `package.json` |
| Extension state | `src/shared/storage/state-keys.ts` |
| Project rules | `.dietcoderules/` |
| Ignore patterns | `.dietcodeignore` → `DietCodeIgnoreController` |
| Skills | `use_skill` + skill packages |
| Workflows | `.dietcoderules/workflows/` → slash by filename |
| MCP servers | Global storage MCP dir + `McpHub` |
| Remote config | `fetchRemoteConfig` in controller |

---

## 12. Roadmap steering

When `lumi.roadmap.enabled` (default `true`):

- `RoadmapFileWatcher` reacts to `ROADMAP.md` changes
- `roadmap` and `roadmap_checkpoint` tools available to agent
- `/roadmap` slash command (`RoadmapSlashCommand`)
- Completion blocked when validation pending (`blockKanbanOnValidationPending`)
- Fail-closed gates (`failClosedCompletionGates`)

Implementation: `src/services/roadmap/` (26 files).

---

## 13. Security model

| Control | Implementation |
|---------|----------------|
| Approval before mutation | Tool UI + auto-approve rules |
| Secret exclusion | `.dietcodeignore`, user discipline |
| Credential storage | VS Code secret storage via `StateManager` |
| Command permissions | `CommandPermissionController` |
| Hook cancellation | `cancel: true` in hook output |
| Local-first task data | Disk persistence under extension storage |

API keys go to **selected provider only** — not to a LUMI backend by default (unless using hosted auth via `AuthService`).

---

## 14. Development and verification

```bash
npm run install:all
npm run dev              # protos + watch
npm run dev:webview      # Vite HMR for sidebar
npm run check-types
npm run test:unit
npm run test:integration
npm run package          # VSIX
npm run roadmap:audit
npm run docs:check-links
```

Extension activation: `src/extension.ts` (~788 lines). Registry: `src/registry.ts` — command prefix `lumi` when package name is `lumi`.

---

## 15. Guarantees and limits

| Guaranteed | Not guaranteed |
|------------|----------------|
| Default approval path for mutating tools | Correct LLM reasoning |
| 4 providers wired in `buildApiHandler` | All provider UI components functional |
| 62 enum tool names; coordinator routing | Every enum has active handler (some reserved) |
| Completion pipeline on `attempt_completion` | Zero false gate blocks |
| BroccoliDB tools when package present | Spider/kernel without dependency |
| VS Code as host | JetBrains, CLI, headless agent |

---

## 16. Related documents

| Document | Scope |
|----------|-------|
| [Philosophy](philosophy.md) | Why calm agency |
| [Companion Brief](companion-brief.md) | Executive metrics |
| [Architecture (current)](../architecture/current.md) | Module reference |
| [System communication](../SYSTEM_COMMUNICATION.md) | IPC detail |
| [BroccoliDB whitepaper](../../broccolidb/docs/papers/whitepaper.md) | Substrate |

---

## Appendix A: Key file index

| File | Purpose |
|------|---------|
| `src/extension.ts` | Activation, commands, HostProvider init |
| `src/core/controller/index.ts` | Controller |
| `src/core/task/index.ts` | Task loop |
| `src/core/task/tools/ToolExecutorCoordinator.ts` | Tool routing |
| `src/shared/tools.ts` | Tool enum |
| `src/core/api/index.ts` | Provider factory |
| `src/shared/providers/providers.json` | Active provider list |
| `src/core/task/tools/completionGatePipeline.ts` | Completion gates |
| `src/core/hooks/hook-factory.ts` | Hook types |
| `src/hosts/host-provider.ts` | Host abstraction |
| `package.json` | Extension manifest, `lumi.*` commands |

---

*This whitepaper describes LUMI as implemented in the codemarie-new agent workspace. Figures are verifiable from source; re-run counts after major refactors.*
