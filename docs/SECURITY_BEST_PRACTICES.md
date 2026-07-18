---
title: "Security & Best Practices"
sidebarTitle: "Security"
description: "How LUMI protects your code — approval gates, hooks, ignore files, and completion checks."
---

# Security & Best Practices

LUMI has physical access to your workspace (files, terminal, browser, MCP). Security is implemented as **layers in code**, not policy PDFs.

## Security model (implemented)

| Layer | What it does | Where |
|-------|--------------|-------|
| **Tool approval** | Every operation receives one recorded approval decision before a permit can exist | `ExecutionFunnel` + webview projection |
| **Auto-approve policy** | Eligible intents use current per-capability settings, command safety/permission, and MCP policy | `src/core/task/tools/execution/ExecutionFunnel.ts` |
| **Read-only allowlist** | 13 tools may run without blocking checkpoints | `READ_ONLY_TOOLS` in `src/shared/tools.ts` |
| **Hooks** | Cancel or modify context at 8 lifecycle points | `src/core/hooks/hook-factory.ts` |
| **Completion gates** | `attempt_completion` blocked until audit/roadmap/focus checks pass | `completionGatePipeline.ts` |
| **Ignore file** | Exclude paths from agent context | `.dietcodeignore` → `DietCodeIgnoreController` |
| **Command permissions** | Restrict shell commands when configured | `CommandPermissionController` |
| **Credential storage** | API keys in VS Code secret storage | `StateManager` / `state-keys.ts` |
| **Roadmap fail-closed** | Optional block when `ROADMAP.md` invalid | `lumi.roadmap.failClosedCompletionGates` |

## Human-in-the-loop (default)

LUMI cannot write files, run commands, browse, or call MCP tools without going through the tool execution pipeline and — unless auto-approve matches — **your explicit approval**.

Read-only exploration (`read_file`, `search_files`, `web_fetch`, …) is designed to gather context without repeated prompts. **Mutation always earns scrutiny** unless you configure otherwise.

See [Philosophy — Approval is the contract](papers/philosophy.md#iv-approval-is-the-contract).

## Data flow

| Data | Stays local? | Notes |
|------|--------------|-------|
| Source files | Yes | Read/written only through approved tools |
| Task history | Yes | Extension global storage + disk under task ULID |
| API keys | Yes (OS secret store) | Sent only to **your chosen provider** |
| LLM prompts/responses | Provider-dependent | OpenRouter, NousResearch, Cloudflare, or OpenAI Codex |
| BroccoliDB SQLite | Yes | `@noorm/broccolidb` on your machine |
| Telemetry | Configurable | See enterprise monitoring docs if enabled |

This build wires **four providers** (`src/shared/providers/providers.json`). Keys are not routed through a LUMI backend unless you use hosted auth (`AuthService`).

## Best practices

### 1. Use `.dietcodeignore`

Exclude secrets and noise from context:

```gitignore
.env
.env.*
**/.ssh/
**/credentials.json
node_modules/
dist/
*.pem
```

Patterns work like `.gitignore`. See [dietcodeignore](customization/dietcodeignore.mdx).

### 2. Review every diff

Before **Approve**, use the built-in diff view (`VscodeDiffViewProvider`). The companion is calm, not invisible.

### 3. Scope auto-approve narrowly

Auto-approve is for trusted workflows (e.g. read-only research), not blanket YOLO. See [auto-approve](features/auto-approve.mdx).

### 4. Use hooks for org policy

`PreToolUse` can cancel dangerous tools. `UserPromptSubmit` can inject compliance context. Scripts live in `.dietcoderules/hooks/`. See [hooks](customization/hooks.mdx).

### 5. Enable roadmap gates for team projects

When using `ROADMAP.md` steering, keep `lumi.roadmap.blockKanbanOnValidationPending` enabled. Validation is **enforced automatically** at `attempt_completion` — agents do not need a manual `roadmap(action='validate')` step. If completion is blocked, agents should edit `ROADMAP.md` per the gate message. See [Roadmap steering](features/roadmap-steering.mdx) and the [auto-governance post-mortem](features/roadmap-auto-governance-postmortem.mdx).

### 6. Set provider spending limits

Use OpenRouter or provider dashboards to cap cost. Plan mode can use a cheaper model than Act mode.

### 7. Audit MCP servers

MCP tools run through `use_mcp_tool` with the same approval path. Only install servers you trust.

## Subagents

Subagents inherit parent approval and hooks. They do not bypass the tool coordinator. See [Working with subagents](WORKING_WITH_SUBAGENTS.md).

## Structural proof (BroccoliDB)

Repository structure and repair governance live in **BroccoliDB**, not the sidebar. LUMI integrates via cognitive memory tools, Spider policy (`src/core/policy/spider/`), and `dietcode_kernel`.

For substrate security (modes, policies, repair executor), read [BroccoliDB philosophy](../broccolidb/docs/papers/philosophy.md).

## Related

- [Security model in whitepaper](papers/whitepaper.md#13-security-model)
- [Completion gates](papers/whitepaper.md#73-completion-gate-pipeline)
- [Architecture (current)](architecture/current.md)
