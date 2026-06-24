# LUMI: A Philosophy of Calm Agency

*Design values grounded in the agent workspace implementation (`src/`, `webview-ui/`).*

> **Related:** [Agent stack](../AGENT_STACK.md) · [Companion brief](companion-brief.md) · [Whitepaper](whitepaper.md) · [Governed swarms](../governed-subagent-execution.md)

---

## I. Thesis

**A coding companion is not finished until you can keep it open all day without feeling managed by it.**

LUMI (`CardSorting.lumi`, `package.json` v2.1.0) is the **agent layer** of the codemarie-new monorepo: a VS Code extension that plans, proposes, and executes — but never assumes consent. Comfort is UX. **Agency with approval** is architecture.

BroccoliDB (`@noorm/broccolidb`) governs repository substrate — proof, repair, durable graph truth. LUMI governs **the human session** — chat, diffs, terminal, browser, MCP, governed swarm receipts, and the moment you click Approve.

Confusing the two — letting companion warmth substitute for approval discipline — is how agents become fluent without becoming trustworthy.

---

## II. The chain (implemented, not metaphor)

Each line maps to code you can open:

| Doctrine | Implementation |
|----------|----------------|
| User expresses intent | Chat input, @ mentions, slash commands |
| Controller holds session truth | `src/core/controller/index.ts` — class `Controller` |
| Task runs the loop | `src/core/task/index.ts` — observe → stream → tool → repeat |
| Tools are typed and routed | `DietCodeDefaultTool` in `src/shared/tools.ts` → `ToolExecutorCoordinator` |
| Host bridge executes physically | `HostProvider` → `src/hosts/vscode/hostbridge/` |
| Approval gates mutating work | Webview diff view + `autoApprove.ts` + user response |
| Hooks intercept lifecycle | 8 hook kinds in `src/core/hooks/hook-factory.ts` |
| Completion is earned | `completionGatePipeline.ts` + roadmap gates + audit checklist |
| Parallel lanes are governed | `use_subagents` → `GovernedSwarmCoordinator` + `LockNecessity` + `MergeGate` |
| Mutation earns ownership | `LockAuthority` — lease + fencing token; read lanes skip locks |
| Swarm truth is durable | Governed receipt schema v3 + `.governed.history.jsonl` — not chat status |
| Memory outlives chat | `@noorm/broccolidb` via cognitive memory tools + SQLite |
| Structure is provable | Spider via `src/core/policy/spider/` + `dietcode_kernel` tool |

```
Prompt     → parseMentions + parseSlashCommands
Session    → Controller + StateManager
Reason     → buildApiHandler → LLM stream
Act        → ToolExecutorCoordinator → handlers/*
Physical   → HostProvider.hostBridge (gRPC)
Consent    → Approve / Reject / Auto-approve rules
Finish     → attempt_completion → completionGatePipeline
Swarm      → classify intent → acquire (or skip lock) → merge gate → seal receipt
Truth      → BroccoliDB graph + governed receipts on disk
```

Crossing a boundary — mutating without approval, skipping hooks when enabled, completing without gate passage — is misuse the pipeline is designed to block or surface.

---

## III. Comfort without surrender

The webview north star (`webview-ui/docs/LUMI_UX.md`):

> Can someone keep this open all day without feeling managed by it?

That is not softness about safety. It is **respect for attention**:

- Copy lives in `webview-ui/src/copy/lumiVoice.ts` — conversational, not alarmist.
- Long sessions use comfort hooks (`useLumiSessionComfort.ts`) — reduce visual noise, not reduce gates.
- Audit presentation reads like a notebook (`auditUiStyles.ts`), not a tribunal.

**Calm is not passive.** LUMI still shows every diff. It still asks before `execute_command`. It still runs completion gates before `attempt_completion` succeeds. For governed swarms, the **incident console** (`GovernedReceiptPanel`) shows execution mode and lock skipped/required — so operators are not alarmed by lanes that never needed ownership.

Teachability is trust. If the UI hides what the agent did, the companion has failed. If the UI cries "missing lock" on a read-only audit lane, the companion has also failed.

---

## IV. Plan and Act are ethical partitions

Modes (`src/shared/storage/types.ts`: `"plan" | "act"`) are not difficulty settings. They are **posture**:

| Mode | Tool | Philosophy |
|------|------|------------|
| **Plan** | `plan_mode_respond` | Understand before touching — read, search, discuss |
| **Act** | `act_mode_respond` | Implement with explicit tool approval |

Plan and Act can use **different providers** (`planModeApiProvider`, `actModeApiProvider`). Thinking cheaply and acting precisely is a design affordance, not a hack.

`/replan` exists because direction changes mid-task are normal — not failures. The agent should pivot without pretending the old plan never happened.

---

## V. Approval is the contract

LUMI's power is physical access: files, shell, browser, MCP. The contract:

1. **Propose** — tool call visible in chat with parameters.
2. **Review** — diff view for edits; output preview for commands.
3. **Consent** — user approves, rejects, or auto-approve rule matches.
4. **Execute** — host bridge performs the action.
5. **Record** — result returns to conversation; hooks fire.

`READ_ONLY_TOOLS` in `src/shared/tools.ts` (12 tools) may run without blocking checkpoint commits — exploration should not feel like negotiation. **Mutation always earns scrutiny** unless you explicitly configure otherwise.

Auto-approve is opt-in trust, not default autonomy.

---

## VI. Completion is gated, not declared

Any agent can say "I'm done." LUMI treats `attempt_completion` as a **request**, not a fact.

`completionGatePipeline.ts` orchestrates:

- Audit alignment with plan baseline
- Focus chain completeness
- Roadmap validation (`RoadmapCompletionGate`, `lumi.roadmap.*` settings)
- Result quality and length checks
- Circuit breakers against duplicate completion spam

Philosophy encoded as pipeline order:

1. Did the work match the stated task?
2. Did audit/policy pass?
3. Did roadmap steering agree (when enabled)?
4. Only then — present completion to the user.

BroccoliDB proves structure; LUMI proves **the session earned its ending**.

---

## VI-A. Swarm success is gated, not declared

A parent can spawn five subagents and call the swarm "done." LUMI treats swarm success as a **reconciliation outcome**, not a chat assertion.

The governed harness mirrors single-task completion discipline at swarm scale:

| Single task | Governed swarm | Shared philosophy |
|-------------|----------------|-------------------|
| `attempt_completion` | `sealReceipt` / `sealCrashReceipt` after `runMergeGate` | Success is requested, then verified |
| `completionGatePipeline` | Preflight + per-lane `completion_gate`; `MergeGate` at seal | Fail closed — violations block pass |
| Roadmap gates at completion | Pressure + orchestration lease at admit; optional completion policy at seal | Roadmap owns plan/admission — not blind mutation |
| User sees why completion blocked | `GovernedReceiptPanel` violations | Teachability over vibes |
| Checkpoints preserve rollback | `attemptId` + `history.jsonl` lineage | Truth survives retries |

**Three gates, one posture** — same calm agency at every layer:

1. **Tool gate** — approve mutating tool calls (or explicit auto-approve).
2. **Task gate** — `completionGatePipeline` before the session ends.
3. **Swarm gate** — `MergeGate` before parallel lanes merge into success.

Swarm gate rules encode intent, not suspicion:

- Read-only lanes reading the same file do not collide.
- Mutation lanes writing the same path in parallel do.
- Lanes that skip locks still emit receipts — **receipts preserve truth** even when **locks protect mutation**.

The lock-necessity classifier exists because the earlier failure mode was not vague prompts — it was **false-positive ownership**: audit lanes acquiring mutation locks they never needed, creating stale claims, merge failures, and operator noise.

Vague escalation prompts remain allowed. Over-locking does not.

---

## VII. Extension without chaos

MCP, hooks, skills, workflows, and subagents extend LUMI — they do not bypass it:

| Extension | Boundary |
|-----------|----------|
| **MCP** | External tools still flow through `use_mcp_tool` + approval |
| **Hooks** | 8 lifecycle points; can cancel or modify context, not silently mutate disk |
| **Skills** | On-demand via `use_skill` — not always-on prompt bloat |
| **Workflows** | Slash-invoked markdown — explicit, not ambient |
| **Subagents** | `use_subagents` + dynamic handlers — same hook and approval inheritance |
| **Governed swarms** | Parent coordinates; lanes declare execution mode; merge gate before success |

The agent layer refuses to become an ungoverned plugin host. Extensions attach to **tool contracts**, not raw filesystem access.

### Governed parallelism (locks protect mutation; receipts preserve truth)

Parallel subagents are not a license to collide. The harness separates **ownership** from **evidence**:

| Concern | Mechanism | Philosophy |
|---------|-----------|------------|
| Who may mutate? | `LockAuthority` — only when `classifyLockNecessity()` says so | Read/audit lanes should not fight over files they only inspect |
| What happened? | `LaneExecutionReceipt` per lane — with or without `claimId` | Chat is not the audit trail; receipts are |
| Is merge safe? | `MergeGate` — write-set overlap only | Parallel reads are a feature, not a incident |
| Can operator trust status? | `GovernedReceiptPanel` incident console | Calm UX still shows mode, lock skipped/required, violations |

Six **execution modes** (`read_only`, `audit_only`, `planning_only`, `documentation_only`, `diagnostic_only`, `mutation`) let harness authors opt out of mutation locks without opting out of durability. Default unmarked lanes remain `mutation` — backward compatible with edit-heavy swarms.

**Industry posture (without pretending we are a distributed database):** leases and fencing tokens for mutation ownership; optimistic parallel execution with merge-before-commit; append-only receipt lineage. Familiar patterns, editor-local implementation.

| Practitioner concept | LUMI expression |
|---------------------|-----------------|
| Lease | In-process claim TTL + file lock under `.broccolidb/governed/locks/` |
| Fencing token | `fencingToken` + broccoli fence file — stale primary cannot release blindly |
| OCC / merge gate | Lanes run in parallel; `MergeGate` reconciles write sets at seal |
| Event log | `claimHistory`, `.governed.history.jsonl`, transcript `.jsonl` |
| Workflow run ID | `attemptId` + `parentAttemptId` retry chain |

Vague escalation prompts are not blocked by default. False-positive locks are. That is the lock-necessity pass in code, not a vibe.

**Harness author rule of thumb:** if a lane only reads, inspects, plans, or appends diagnostic evidence — declare `[execution_mode:read_only]` (or audit/plan/doc/diagnostic). If it edits files — `mutation` or `[write_set:…]`. Do not default to mutation for review lanes.

Full architecture: [Governed subagent execution](../governed-subagent-execution.md) · Operator playbook: [runbook](../governed-execution-runbook.md) · ADRs: [decisions](../governed-execution-decisions.md).

---

## VIII. What the workspace refuses

Observed absences are design choices:

| Refusal | Evidence |
|---------|----------|
| Silent file writes | Write handlers require approval path |
| Mystery provider routing | `providers.json` lists 4 wired providers; `buildApiHandler` matches |
| Chat as sole memory | BroccoliDB cognitive tools + disk persistence |
| IDE lock-in at core | `HostProvider` abstracts VS Code; core avoids direct `vscode` imports |
| Completion on vibes | `completionGatePipeline` + tests in `attemptCompletionUtils.test.ts` |
| Parallel swarm chaos | `MergeGate` + lock-necessity + roadmap orchestration lease |
| Chat as swarm audit trail | Governed receipt v3 + `auditIntegration` + `history.jsonl` |
| BroccoliDB as swarm audit store | Receipt-local audit under `subagent_executions/`; BroccoliDB = substrate |
| Companion without substrate | `@noorm/broccolidb` dependency in root `package.json` |

We refuse another headless agent framework because developers already live in an editor. LUMI meets them **in the sidebar they already trust**.

---

## IX. Relationship to BroccoliDB

| Layer | Package | Question it answers |
|-------|---------|-------------------|
| **LUMI** | Root extension | "What should we do in this session, with my consent?" |
| **LUMI governed receipts** | `subagent_executions/*.governed.*` | "What did each swarm lane do, was merge safe, and what did audit/roadmap record?" |
| **BroccoliDB** | `@noorm/broccolidb` | "What happened to the repository, and is structure still true?" |

LUMI calls BroccoliDB through cognitive memory tools, `dietcode_kernel`, and Spider integration in `src/core/policy/spider/`. Governed swarm receipts live in the **session artifact layer** (per-task `subagent_executions/`), not in chat memory and not in BroccoliDB CAS audit events. The companion proposes; the substrate proves and persists; **swarm receipts record parallel lane truth without conflating locks with evidence**.

**Final invariant across planes:** Roadmap owns plan and execution admission. Audit owns verification. MergeGate owns commit safety. BroccoliDB owns fencing/replay substrate. Receipts own truth.

Read BroccoliDB's papers for substrate philosophy. Read LUMI's papers for session philosophy. **Do not merge them.**

---

## X. Measure of done

Done is falsifiable:

```bash
npm run check-types && npm run test:unit
npm run test:unit -- --grep "governed execution"
npm run package   # produces installable VSIX
```

Done is a developer installing `CardSorting.lumi`, running a task, approving one edit, and feeling **in control** — not supervised.

Done is `/compact` recovering a long session without losing decisions.

Done is `attempt_completion` blocked when roadmap validation pending — and the user understanding why.

Done is a governed swarm where read-only review lanes show **lock skipped** in the incident console — and the operator does not file a false "missing lock" ticket.

Done is merge blocked on `unsafe mutation overlap` — not on two auditors reading the same file.

Done is a swarm that passes roadmap pressure admission, acquires an orchestration lease, runs DAG-ordered lanes, and seals a receipt where `auditIntegration.mergeGateRole` is `commit_barrier` — not confused with workspace audit.

Done is a timeout that produces `sealCrashReceipt` with a precise crash phase — without overwriting a prior sealed success in history.

When teams stop discussing LUMI's sidebar and return to discussing their product, the companion has succeeded.

---

## XI. Closing doctrine

Build a companion that **respects attention** in the webview.  
Build a controller that **holds one task** honestly.  
Build a loop that **streams, parses, and executes** through typed tools.  
Build approval that **defaults to ask**, not assume.  
Build Plan and Act as **separate postures**, not labels.  
Build completion that **passes gates**, not wishes.  
Build extensions that **attach to tools**, not bypass them.  
Build governed swarms where **locks protect mutation** and **receipts preserve truth**.  
Build memory on **BroccoliDB**, not chat scrollback.

Then stop adding agent features and start **refining the session**.

That is the philosophy of LUMI — as implemented in this workspace.

---

## See also

- [Technical Whitepaper](whitepaper.md) — measured claims and tables
- [Companion Brief](companion-brief.md) — executive numbers
- [Governed subagent execution](../governed-subagent-execution.md) — lock necessity, merge gate, receipts
- [Governed execution runbook](../governed-execution-runbook.md) — operator playbook
- [Governed execution decisions](../governed-execution-decisions.md) — ADRs
- [Architecture (current)](../architecture/current.md)
- [BroccoliDB Philosophy](../../broccolidb/docs/papers/philosophy.md) — substrate layer
- `src/core/task/tools/completionGatePipeline.ts` — completion doctrine in code
- `src/core/task/tools/subagent/GovernedSwarmCoordinator.ts` — swarm lifecycle in code
- `webview-ui/docs/LUMI_UX.md` — comfort north star
