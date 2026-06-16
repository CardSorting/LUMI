---
title: "Codebase Standards & Rules"
sidebarTitle: "Codebase Standards"
description: "How LUMI maps to the agent workspace layout and how to keep projects AI-friendly."
---

# Codebase Standards & Rules

This guide covers (1) how **this repository** is structured for the LUMI agent, and (2) how **your project** can stay easy for LUMI to work in.

## Agent workspace layout (this repo)

Verified map — full detail in [Project map](PROJECT_MAP.md):

| Directory | Role |
|-----------|------|
| `src/core/controller/` | Session controller, MCP, gRPC handlers |
| `src/core/task/` | Agent loop (~4k lines) |
| `src/core/task/tools/` | Tool coordinator + handlers |
| `src/core/api/` | LLM providers (4 wired) |
| `src/core/context/` | Context window, rules, file tracking |
| `src/core/hooks/` | Lifecycle hooks |
| `src/core/storage/` | StateManager, disk persistence |
| `src/hosts/vscode/` | VS Code host bridge (only full host) |
| `src/integrations/` | Checkpoints, terminal, diff |
| `src/services/` | MCP, browser, roadmap, tree-sitter |
| `src/infrastructure/` | DB pool, orchestrator |
| `webview-ui/` | React sidebar — **LUMI** user-facing copy |
| `broccolidb/` | Substrate package (separate docs) |

### Dependency discipline

- **Core** must not import `vscode` directly — use `HostProvider`.
- **Host-specific** code stays under `src/hosts/vscode/`.
- **BroccoliDB** is consumed via `@noorm/broccolidb` and tool handlers, not by duplicating substrate logic in the extension.

### UI copy

| User-facing strings live in `webview-ui/src/copy/lumiVoice.ts`. North star: [LUMI UX](../../webview-ui/docs/LUMI_UX.md) — *keep it open all day without feeling managed*.

## Your project: AI-friendly patterns

- **Type safety** — Prefer explicit types; avoid `any` in code LUMI will edit.
- **Clear module boundaries** — One primary responsibility per file; refactor before files exceed ~1,500 lines.
- **Descriptive names** — Functions and types should read without comments.
- **Lint config** — LUMI respects existing Biome/ESLint setups in the workspace.

## Enforcing standards in your repo

| Mechanism | Purpose |
|-----------|---------|
| [`.dietcoderules/`](customization/dietcode-rules.mdx) | Always-on project rules |
| [Workflows](customization/workflows.mdx) | Slash-invoked playbooks |
| [Hooks](customization/hooks.mdx) | Cancel or steer tools at runtime |
| [`.dietcodeignore`](customization/dietcodeignore.mdx) | Hide secrets and deps from context |
| **JoyZoning audit** | Architecture/layer compliance (`lumi.joyZoningAudit`) |
| **Spider / stability tools** | Structural checks via BroccoliDB integration |

## JoyZoning

The sidebar includes **JoyZoning Audit** (`lumi.joyZoningButtonClicked`) for architecture compliance review. This is separate from everyday lint — it targets layering and structural discipline.

## Related

- [Philosophy — extension without chaos](papers/philosophy.md#vii-extension-without-chaos)
- [Security best practices](SECURITY_BEST_PRACTICES.md)
- [BroccoliDB codebase standards](../broccolidb/docs/papers/philosophy.md) — substrate layering
