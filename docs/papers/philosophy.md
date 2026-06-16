# LUMI: A Philosophy of Calm Agency

*Design values grounded in the agent workspace implementation (`src/`, `webview-ui/`).*

> **Related:** [Agent stack](../AGENT_STACK.md) · [Companion brief](companion-brief.md) · [Whitepaper](whitepaper.md)

---

## I. Thesis

**A coding companion is not finished until you can keep it open all day without feeling managed by it.**

LUMI (`CardSorting.lumi`, `package.json` v1.0.3) is the **agent layer** of the codemarie-new monorepo: a VS Code extension that plans, proposes, and executes — but never assumes consent. Comfort is UX. **Agency with approval** is architecture.

BroccoliDB (`@noorm/broccolidb`) governs repository substrate — proof, repair, durable graph truth. LUMI governs **the human session** — chat, diffs, terminal, browser, MCP, and the moment you click Approve.

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
Truth      → BroccoliDB graph + task history on disk
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

**Calm is not passive.** LUMI still shows every diff. It still asks before `execute_command`. It still runs completion gates before `attempt_completion` succeeds.

Teachability is trust. If the UI hides what the agent did, the companion has failed.

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

`READ_ONLY_TOOLS` in `src/shared/tools.ts` (13 tools) may run without blocking checkpoint commits — exploration should not feel like negotiation. **Mutation always earns scrutiny** unless you explicitly configure otherwise.

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

## VII. Extension without chaos

MCP, hooks, skills, workflows, and subagents extend LUMI — they do not bypass it:

| Extension | Boundary |
|-----------|----------|
| **MCP** | External tools still flow through `use_mcp_tool` + approval |
| **Hooks** | 8 lifecycle points; can cancel or modify context, not silently mutate disk |
| **Skills** | On-demand via `use_skill` — not always-on prompt bloat |
| **Workflows** | Slash-invoked markdown — explicit, not ambient |
| **Subagents** | `use_subagents` + dynamic handlers — same hook and approval inheritance |

The agent layer refuses to become an ungoverned plugin host. Extensions attach to **tool contracts**, not raw filesystem access.

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
| Companion without substrate | `@noorm/broccolidb` dependency in root `package.json` |

We refuse another headless agent framework because developers already live in an editor. LUMI meets them **in the sidebar they already trust**.

---

## IX. Relationship to BroccoliDB

| Layer | Package | Question it answers |
|-------|---------|-------------------|
| **LUMI** | Root extension | "What should we do in this session, with my consent?" |
| **BroccoliDB** | `@noorm/broccolidb` | "What happened to the repository, and is structure still true?" |

LUMI calls BroccoliDB through cognitive memory tools, `dietcode_kernel`, and Spider integration in `src/core/policy/spider/`. The companion proposes; the substrate proves and persists.

Read BroccoliDB's papers for substrate philosophy. Read LUMI's papers for session philosophy. **Do not merge them.**

---

## X. Measure of done

Done is falsifiable:

```bash
npm run check-types && npm run test:unit
npm run package   # produces installable VSIX
```

Done is a developer installing `CardSorting.lumi`, running a task, approving one edit, and feeling **in control** — not supervised.

Done is `/compact` recovering a long session without losing decisions.

Done is `attempt_completion` blocked when roadmap validation pending — and the user understanding why.

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
Build memory on **BroccoliDB**, not chat scrollback.

Then stop adding agent features and start **refining the session**.

That is the philosophy of LUMI — as implemented in this workspace.

---

## See also

- [Technical Whitepaper](whitepaper.md) — measured claims and tables
- [Companion Brief](companion-brief.md) — executive numbers
- [Architecture (current)](../architecture/current.md)
- [BroccoliDB Philosophy](../../broccolidb/docs/papers/philosophy.md) — substrate layer
- `src/core/task/tools/completionGatePipeline.ts` — completion doctrine in code
- `webview-ui/docs/LUMI_UX.md` — comfort north star
