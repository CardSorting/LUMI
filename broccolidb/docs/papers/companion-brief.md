# BroccoliDB Companion Brief

**Executive summary · v30 · workspace-verified**

*Companion to the [Technical Whitepaper](whitepaper.md). All figures below are measured from the `broccolidb/` tree.*

---

## One sentence

**BroccoliDB** (`@noorm/broccolidb`) is a governed agent substrate in the codemarie-new monorepo: 12 capabilities, Spider structural proof, a single repair mutation path, and durable session memory that survives process restart.

---

## By the numbers

| Metric | Value | Where |
|--------|-------|-------|
| Test files | **69** | `broccolidb/tests/` |
| Public API export groups | **49** | `public-api-snapshot.test.ts` |
| Capabilities | **12** | `intent-types.ts` |
| Runtime graph node kinds | **16** | `orchestration/state/types.ts` |
| RTG integrity diagnostics | **8** | `RTG-001`–`RTG-008` |
| SPI structural diagnostics | **10** | `SPI-001`–`SPI-010` |
| Runtime modes | **6** | `development`, `ci`, `production`, `readonly`, `recovery`, `forensic` |
| Approval policies | **6** | incl. `human_approval_required`, `autonomous_safe` |
| Spider MCP tools | **9** | `spider-mcp-tools.ts` |
| Total MCP tools | **67** | `core/mcp.ts` |
| Golden examples | **7** | `examples/*.ts` |
| Typed error codes | **39** | `core/errors.ts` |
| Graph schema version | **29.0.0** | `RUNTIME_GRAPH_SCHEMA_VERSION` |
| Compatibility exceptions | **0** | `compatibility-purge.ts` (empty) |

---

## What problem it solves

After an agent run, operators need answers — not log grep. BroccoliDB records:

- **What was called** → `IntentTracer` per capability
- **What was proven** → Spider audit nodes in `RuntimeStateGraph`
- **What was planned/executed** → `MutationPlan` / `RepairExecutor` chain
- **What blocked** → `ctx.runtime.blockers()`
- **What happened in plain language** → `ctx.runtime.story(sessionId)`
- **What survives restart** → integrity-checked snapshots + `restorePersistedSessions()`

The parent repo’s **MIRA** readme describes the IDE companion; **BroccoliDB** is the repository floor underneath.

---

## Architecture (10 seconds)

```
Agent → ctx.<capability> → OrchestrationRuntime → RuntimeStateGraph → CAS snapshot
              ↓
        ctx.graph.spider (read-only proof)
              ↓
        RepairExecutor (only mutation path)
```

**Hard rule:** `await ctx.start()` before capabilities; `await ctx.stop()` in `finally`.

---

## Runtime modes (actual code)

| Mode | Default policy | Executes? |
|------|----------------|-----------|
| `development` | `autonomous_safe` | Yes (local agent work) |
| `ci` | `ci_gate_only` | Safe-only |
| `production` | `human_approval_required` | Safe-only, strict verify |
| `readonly` / `forensic` | `readonly` | No mutations |
| `recovery` | `recovery_mode` | Yes (restore workflows) |

Policies (`autonomous_safe`, `human_approval_required`, …) are passed to `planRepairs` / `execute` — they are **not** runtime modes.

---

## v30 deliverables (shipped)

- Frozen `core/public-api.ts` + CI allowlist
- `GuidedError` (extends `LifecycleStateError`) with fix text
- CLI: `health`, `spider gate|compact`, `runtime state|replay|story|snapshot`
- `broccolidb/docs/` + 3 papers + 7 runnable examples
- Guardrails: API snapshot, naming ban, docs links, CLI smoke, examples smoke, **recovery smoke**

---

## Integration checklist

- [ ] `await ctx.start()` / `ctx.stop()` in `finally`
- [ ] Spider only via `ctx.graph.spider` (never `SpiderService`)
- [ ] `recordAudit` + `recordGate` in a `beginSession` session
- [ ] Repairs only via `ctx.runtime.execute` (`RepairExecutor`)
- [ ] `snapshot(sessionId)` before critical/shutdown work
- [ ] New `BufferedDbPool` after `stop()` for restart (pool cannot resume)
- [ ] Import from `@noorm/broccolidb` public API only
- [ ] Catch `GuidedError`, `PolicyBlockedError`, `RuntimeBudgetExceededError`

---

## CLI (copy-paste)

```bash
cd your-repo && npx broccolidb init
npx broccolidb health --format json
npx broccolidb spider gate                    # exit code = gate
npx broccolidb spider compact --format compact
npx broccolidb runtime story <sessionId>
npx broccolidb serve                          # MCP stdio
```

---

## Verify claims yourself

```bash
cd broccolidb
npm run build
npm run test:guardrails    # API, docs, CLI, errors, naming
npm run test:smoke         # snapshot → restart → replay → story
npm run test:examples      # 7 golden paths
npx tsx tests/end-to-end-repair-flow.test.ts   # audit does not mutate disk
```

---

## Guarantees vs non-guarantees

| Guaranteed in code | Not guaranteed |
|--------------------|----------------|
| Audit does not mutate (`end-to-end-repair-flow.test.ts`) | LLM correctness |
| Single orchestration mutation path (`RepairExecutor`) | Tools outside BroccoliDB |
| Snapshot blocked on RTG violations | `BufferedDbPool` restart after `stop()` |
| 49 public exports only | Deep-import internal stability |
| Session restore from DB snapshots | Real-time multi-repo sync |

---

## Read next

| Doc | Audience |
|-----|----------|
| [Whitepaper](whitepaper.md) | Engineers — full depth |
| [Philosophy](philosophy.md) | Values — why boring wins |
| [Getting started](../getting-started.md) | Hands-on |
| [Public API](../public-api.md) | API reference |

**Package:** `@noorm/broccolidb` · **License:** MIT
