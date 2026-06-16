# LUMI Companion Brief

**Executive summary · v1.0.3 · workspace-verified**

*Companion to the [Technical Whitepaper](whitepaper.md). All figures below are measured from the agent workspace (`src/`, `webview-ui/`, root `package.json`).*

---

## One sentence

**LUMI** (`CardSorting.lumi`) is a VS Code agent extension in the codemarie-new monorepo: Plan/Act modes, 62 typed tools, human-in-the-loop approval, MCP and subagent extension, and BroccoliDB-backed memory — designed as a calm coding companion you can keep open all day.

---

## By the numbers

| Metric | Value | Where |
|--------|-------|-------|
| Extension version | **1.0.3** | `package.json` |
| Publisher / ID | **CardSorting.lumi** | `package.json` |
| Registered VS Code commands | **~25** `lumi.*` | `package.json` `contributes.commands` |
| Static tool enum values | **62** | `DietCodeDefaultTool` in `src/shared/tools.ts` |
| Tool handler files | **55** | `src/core/task/tools/handlers/` |
| Read-only tools (checkpoint-safe) | **12** | `READ_ONLY_TOOLS` in `src/shared/tools.ts` |
| Wired LLM providers | **4** | `src/shared/providers/providers.json` |
| Provider handler files (total) | **45** | `src/core/api/providers/` |
| Built-in slash commands | **10** | `SUPPORTED_DEFAULT_COMMANDS` in `src/core/slash-commands/index.ts` |
| Lifecycle hook kinds | **8** | `Hooks` in `src/core/hooks/hook-factory.ts` |
| Agent modes | **2** | `plan` \| `act` — `src/shared/storage/types.ts` |
| Roadmap VS Code settings | **5** | `lumi.roadmap.*` in `package.json` |
| Unit/integration test files (`src/`) | **~190** | `*.test.ts` / `*.spec.ts` under `src/` |
| Core task loop (lines) | **~4,100** | `src/core/task/index.ts` |
| Controller (lines) | **~1,100** | `src/core/controller/index.ts` |

---

## What problem it solves

Developers want an AI pair programmer **inside the editor** — not a separate app, not a black box, not an autonomous script. LUMI delivers:

| Need | LUMI answer |
|------|-------------|
| See what changed before it lands | Diff view + approve/reject per tool |
| Long sessions without context collapse | `/compact`, `summarize_task`, BroccoliDB memory tools |
| Plan before mutating | Plan mode + `plan_mode_respond` |
| Extend with company tools | MCP via `use_mcp_tool` |
| Delegate parallel work | `use_subagents` + dynamic subagent tools |
| Steer multi-step projects | `ROADMAP.md` + `roadmap` / `roadmap_checkpoint` tools |
| Custom guardrails | Hooks (PreToolUse, PostToolUse, …) + `.dietcoderules/` |

**BroccoliDB** underneath answers forensic repository questions. **LUMI** answers session questions — in the sidebar.

---

## Architecture (10 seconds)

```
User → webview-ui (React)
         ↕ protobuf / gRPC handlers
       Controller → Task loop
         ↕ buildApiHandler (4 providers)
       LLM stream → ToolExecutorCoordinator → HostProvider.hostBridge
         ↕
       VS Code (files, terminal, diff, browser)
         ↕
       @noorm/broccolidb (memory, Spider, kernel)
```

**Hard rules:** mutating tools require approval (unless auto-approve); `attempt_completion` runs `completionGatePipeline`; hooks can cancel but do not silently write files.

---

## Modes (actual code)

| Mode | Response tool | Typical posture |
|------|---------------|-----------------|
| `plan` | `plan_mode_respond` | Read, search, discuss — no writes |
| `act` | `act_mode_respond` | Implement — mutating tools with approval |

Each mode can use a **different provider and model** (`planModeApiProvider`, `actModeApiProvider`).

---

## Wired providers (this build)

| Key | Label |
|-----|-------|
| `openrouter` | OpenRouter (default fallback) |
| `openai-codex` | ChatGPT Subscription |
| `nousResearch` | NousResearch |
| `cloudflare` | Cloudflare Workers AI |

Additional provider files exist under `src/core/api/providers/` but are **not registered** in `buildApiHandler` today.

---

## Tool categories (summary)

| Category | Examples | Count (enum) |
|----------|----------|--------------|
| File I/O | `read_file`, `write_to_file`, `apply_patch` | 9 |
| Terminal / web / browser | `execute_command`, `web_fetch`, `browser_action` | 4 |
| MCP | `use_mcp_tool`, `access_mcp_resource` | 3 |
| Interaction | `ask_followup_question`, `attempt_completion` | 6 |
| Cognitive memory | `query_cognitive_memory`, `mem_*` | 21 |
| Stability | `diagnose_stability`, `ast_repair`, … | 8 |
| Roadmap / kernel | `roadmap`, `dietcode_kernel` | 3 |
| Modes / meta | `plan_mode_respond`, `use_subagents`, … | 8 |

Full list: [All tools](../tools-reference/all-dietcode-tools.mdx).

---

## Integration checklist (extension user)

- [ ] Install `CardSorting.lumi` (VSIX or marketplace)
- [ ] Configure Plan and/or Act provider + API key
- [ ] Add `.dietcodeignore` for deps and secrets
- [ ] Optional: `.dietcoderules/` for project rules
- [ ] Optional: MCP servers in LUMI settings
- [ ] Optional: `lumi.roadmap.enabled` for ROADMAP.md steering
- [ ] Optional: hooks in `.dietcoderules/hooks/`

---

## Integration checklist (contributor)

- [ ] `npm run install:all && npm run dev`
- [ ] New tools: add to `DietCodeDefaultTool` + handler + `ToolExecutorCoordinator` map
- [ ] New providers: handler in `src/core/api/providers/` + register in `buildApiHandler` + `providers.json`
- [ ] Webview copy: `webview-ui/src/copy/lumiVoice.ts` — keep calm tone
- [ ] Host-specific code only under `src/hosts/vscode/`
- [ ] Do not import `vscode` from `src/core/task/` — use `HostProvider`

---

## Verify claims yourself

```bash
npm run install:all
npm run check-types
npm run test:unit
npm run package          # VSIX in dist/
npm run roadmap:audit    # ROADMAP consistency
```

---

## Guarantees vs non-guarantees

| Guaranteed in this workspace | Not guaranteed |
|-------------------------------|----------------|
| Approval path for mutating tools (default) | LLM output correctness |
| 4 providers routed in `buildApiHandler` | All 45 provider files active |
| Typed tool enum + coordinator routing | Third-party MCP server behavior |
| Completion gate pipeline on `attempt_completion` | Zero false-positive gate blocks |
| BroccoliDB dependency for memory/kernel tools | BroccoliDB features without `@noorm/broccolidb` |
| VS Code host implementation | JetBrains/CLI (not shipped here) |

---

## Read next

| Doc | Audience |
|-----|----------|
| [Whitepaper](whitepaper.md) | Engineers — full depth |
| [Philosophy](philosophy.md) | Values — calm agency |
| [Architecture (current)](../architecture/current.md) | Module map |
| [Project map](../PROJECT_MAP.md) | 1-to-1 paths |
| [BroccoliDB Companion Brief](../../broccolidb/docs/papers/companion-brief.md) | Substrate layer |

**Extension:** `CardSorting.lumi` · **License:** Apache-2.0 · **Internal prefix:** `DietCode*` types
