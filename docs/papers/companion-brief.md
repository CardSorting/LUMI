# LUMI Companion Brief

**Executive summary · v2.1.0 · workspace-verified**

*Companion to the [Technical Whitepaper](whitepaper.md). All figures below are measured from the agent workspace (`src/`, `webview-ui/`, root `package.json`).*

---

## One sentence

**LUMI** (`CardSorting.lumi-vscode` on VS Marketplace, `CardSorting.lumi` on Open VSX) is a VS Code agent extension in the codemarie-new monorepo: Plan/Act modes, 63 typed tools, human-in-the-loop approval, MCP and governed subagent execution, and BroccoliDB-backed memory — designed as a calm coding companion you can keep open all day.

---

## By the numbers

| Metric | Value | Where |
|--------|-------|-------|
| Extension version | **2.1.0** | `package.json` |
| Publisher / ID | **CardSorting.lumi-vscode** (VS Marketplace) · **CardSorting.lumi** (Open VSX) | `package.json` |
| Registered VS Code commands | **~25** `lumi.*` | `package.json` `contributes.commands` |
| Static tool enum values | **63** | `DietCodeDefaultTool` in `src/shared/tools.ts` |
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
| Governed receipt schema | **v3** | `GOVERNED_RECEIPT_SCHEMA_VERSION` in `src/shared/subagent/governedExecution.ts` |
| Lane execution modes | **6** | `read_only` … `mutation` — `LockNecessity.ts` |
| Lock authority backends | **5** | in-process, SwarmMutex, roadmap lease, file lock, broccoli fence |
| Governed execution test suites | **3** | `governedExecution*.test.ts` under `subagent/__tests__/` |

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
| Parallel review without lock fights | `[execution_mode:read_only]` lanes — lock skipped, receipt durable |
| Reconcile parallel writes | `MergeGate` — optimistic execution, write-set collision check at seal |
| Inspect swarm incidents | `GovernedReceiptPanel` — mode, lock skipped/required, violations |
| Steer multi-step projects | `ROADMAP.md` + `roadmap` / `roadmap_checkpoint` tools |
| Custom guardrails | Hooks (PreToolUse, PostToolUse, …) + `.dietcoderules/` |

**BroccoliDB** underneath answers forensic repository questions. **LUMI** answers session questions — in the sidebar. **Governed receipts** answer swarm questions — on disk, not in chat.

---

## Three gates (same product posture)

LUMI applies **fail-closed verification** at three layers. All three favor teachability over silent success.

| Gate | Trigger | Blocks when | Operator surface |
|------|---------|-------------|------------------|
| **Tool** | Mutating tool call | User rejects (or hook cancels) | Diff view + approval card |
| **Task** | `attempt_completion` | `completionGatePipeline` fails | Model guidance + roadmap messages |
| **Swarm** | `use_subagents` seal | `MergeGate` fails | `GovernedReceiptPanel` violations |

Swarm gate is **mutation-scoped**: parallel reads pass; parallel uncoordinated writes fail.

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

Governed swarm branch (use_subagents):
  SubagentToolHandler → GovernedSwarmCoordinator
    → LockNecessity (classify) → LockAuthority (mutation only)
    → SubagentRunner (lanes) → MergeGate → seal receipt v3
    → GovernedReceiptPanel (incident console)
```

**Hard rules:** mutating tools require approval (unless auto-approve); `attempt_completion` runs `completionGatePipeline`; hooks can cancel but do not silently write files; swarm success requires merge gate pass — **locks protect mutation, receipts preserve truth**.

---

## Governed subagent execution (30 seconds)

Multi-lane swarms are not fire-and-forget parallelism. Each lane declares an **execution mode** before acquire:

| Mode | Lock | Use |
|------|------|-----|
| `read_only`, `audit_only`, `planning_only`, `documentation_only`, `diagnostic_only` | skipped | Review, audit, plan — durable receipt, no ownership |
| `mutation` (default) | required | File edits, durable state changes |

**Invariant:** Locks protect mutation. Receipts preserve truth.

| Artifact | Path |
|----------|------|
| Per-attempt receipt | `subagent_executions/{swarmId}.governed.{attemptId}.json` |
| Attempt lineage | `subagent_executions/{swarmId}.governed.history.jsonl` |
| Swarm envelope | `subagent_executions/{swarmId}.json` |

Authoritative state after a failed retry: last `sealed && mergePassed` in history — not chat status alone.

### Scenario matrix

| Setup | Lock behavior | Merge expectation |
|-------|---------------|-------------------|
| 2× `[execution_mode:read_only]` on same file | Both **lock skipped** | Pass — read overlap OK |
| 2× `mutation` writing same file in parallel | Both **lock required** | Fail — `unsafe mutation overlap` |
| 1× read + 1× mutation on same file | Read skipped, mutation locked | Pass if only mutation writes |
| `documentation_only` + `[write_set:docs/x.md]` | Escalated to lock | Pass when claim acquired + released |
| Audit lane runs `write_to_file` without lock | Skipped at acquire | Fail — `performed writes without lock` |

### Prompt examples

```
[execution_mode:read_only] [read_set:src/api.ts]
Review the public API. Do not modify files.
```

```
[execution_mode:audit_only]
Inspect subagent_executions/{swarmId}.governed.{attemptId}.json and summarize merge violations.
```

```
[execution_mode:mutation]
Refactor src/handler.ts and update tests.
```

Tool param alternative: `execution_mode_1=read_only` for lane index 1.

### Incident console (operator)

`deriveReceiptIncident()` classifies receipts for the sidebar. Common classes:

| Incident | Meaning |
|----------|---------|
| `sealed_success` | Merge passed — safe to treat complete |
| `merge_blocked` | Read violations list — often overlap or missing evidence |
| `partial_receipt` | Interrupted before seal — check claim timeline |
| `stale_claim` | Recover mutation locks before retry |
| `unsafe_retry` | Would supersede sealed prior attempt |
| `replay_mismatch` | Receipt or envelope drift after seal |

**Not an incident:** `lock skipped` on read/audit lanes — expected, not missing lock.

Docs: [governed-subagent-execution.md](../governed-subagent-execution.md) · [runbook](../governed-execution-runbook.md) · [schema](../governed-execution-schema.md) · [decisions](../governed-execution-decisions.md)

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
| Governed harness | `GovernedSwarmCoordinator`, `MergeGate`, `LockNecessity`, `LockAuthority` | — |

Full list: [All tools](../tools-reference/all-dietcode-tools.mdx). Swarm depth: [Governed subagent execution](../governed-subagent-execution.md).

---

## Integration checklist (extension user)

- [ ] Install `CardSorting.lumi-vscode` or `CardSorting.lumi` (VSIX or marketplace)
- [ ] Configure Plan and/or Act provider + API key
- [ ] Add `.dietcodeignore` for deps and secrets
- [ ] Optional: `.dietcoderules/` for project rules
- [ ] Optional: MCP servers in LUMI settings
- [ ] Optional: `lumi.roadmap.enabled` for ROADMAP.md steering
- [ ] Optional: hooks in `.dietcoderules/hooks/`
- [ ] Parallel subagents: use `[execution_mode:read_only]` on review lanes to avoid false lock collisions

---

## Integration checklist (contributor)

- [ ] `npm run install:all && npm run dev`
- [ ] New tools: add to `DietCodeDefaultTool` + handler + `ToolExecutorCoordinator` map
- [ ] New providers: handler in `src/core/api/providers/` + register in `buildApiHandler` + `providers.json`
- [ ] Webview copy: `webview-ui/src/copy/lumiVoice.ts` — keep calm tone
- [ ] Host-specific code only under `src/hosts/vscode/`
- [ ] Do not import `vscode` from `src/core/task/` — use `HostProvider`
- [ ] Governed swarms: update `LockNecessity`, `MergeGate`, or receipt types → sync [governed docs](../governed-subagent-execution.md) + `CODE_TO_DOC_MAP.md`

---

## Verify claims yourself

```bash
npm run install:all
npm run check-types
npm run test:unit
npm run package          # VSIX in dist/
npm run roadmap:audit    # ROADMAP consistency
npm run test:unit -- --grep "governed execution"   # swarm harness contracts
```

---

## Guarantees vs non-guarantees

| Guaranteed in this workspace | Not guaranteed |
|-------------------------------|----------------|
| Approval path for mutating tools (default) | LLM output correctness |
| 4 providers routed in `buildApiHandler` | All 45 provider files active |
| Typed tool enum + coordinator routing | Third-party MCP server behavior |
| Completion gate pipeline on `attempt_completion` | Zero false-positive gate blocks |
| Governed swarm merge gate before seal | Zero false-positive merge blocks |
| Lock-skipped lanes for non-mutating execution modes | Lane DAG deps wired in handler (infra present) |
| Durable governed receipts per swarm attempt | Chat status as authoritative swarm truth |
| BroccoliDB dependency for memory/kernel tools | BroccoliDB features without `@noorm/broccolidb` |
| VS Code host implementation | JetBrains/CLI (not shipped here) |

---

## Read next

| Doc | Audience |
|-----|----------|
| [Whitepaper](whitepaper.md) | Engineers — full depth |
| [Philosophy](philosophy.md) | Values — calm agency |
| [Governed subagent execution](../governed-subagent-execution.md) | Swarm architecture |
| [Governed execution runbook](../governed-execution-runbook.md) | Operators — incidents, retry |
| [Architecture (current)](../architecture/current.md) | Module map |
| [Project map](../PROJECT_MAP.md) | 1-to-1 paths |
| [BroccoliDB Companion Brief](../../broccolidb/docs/papers/companion-brief.md) | Substrate layer |

**Extension:** `CardSorting.lumi-vscode` / `CardSorting.lumi` · **License:** Apache-2.0 · **Internal prefix:** `DietCode*` types
