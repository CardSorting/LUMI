# DietCode Skill: Auto-Rolling Roadmap Checkpoint System

## Skill Purpose

Maintain an evolving `ROADMAP.md` file that acts as the project's living product, architecture, and long-horizon development checkpoint.

This skill exists to prevent code soup, preserve project coherence, and keep long-running development aligned around a clear center of gravity.

The roadmap is not a wishlist.

The roadmap is not a backlog.

The roadmap is not a promise.

The roadmap is the project's steering surface.

It should help humans and agents answer:

* What is this project becoming?
* What matters now?
* What should happen next?
* What should remain deferred?
* What changed recently?
* What risks are accumulating?
* Is the system becoming more coherent or more fragmented?

## Primary Output

This skill must create or update:

```text
ROADMAP.md
```

`ROADMAP.md` is the canonical checkpoint file for long-horizon project steering.

If the file does not exist, create it.

If the file exists, evolve it carefully.

Do not replace useful history with generic text.

Do not append endlessly.

Do not turn the roadmap into a backlog dump.

Each update should make the roadmap more useful, more current, and easier to navigate.

## Prime Directive

Every roadmap pass must answer:

```text
Did the latest work strengthen or weaken the project's center of gravity?
```

If the answer is unclear, the skill must investigate before adding or promoting roadmap items.

A roadmap item that does not connect to the project's center of gravity should remain in Discovery, be reframed, or be archived.

## Definition: Center of Gravity

The project's center of gravity is the smallest set of concepts, workflows, abstractions, and operational paths that explain how the system fundamentally works.

A strong center of gravity means:

* there is one obvious way to perform core operations
* agents can predict where changes belong
* contributors can understand the system without reading everything
* new features attach to existing architecture instead of creating parallel systems
* operational behavior is inspectable
* maintenance burden stays bounded
* long-term development feels navigable

A weak center of gravity means:

* duplicate abstractions appear
* multiple workflows compete
* state ownership becomes unclear
* debugging paths fragment
* agents invent local patterns
* hidden orchestration grows
* roadmap direction becomes disconnected from implementation reality

## Core Philosophy

Centralization does not mean giant files, giant classes, or rigid architecture.

Centralization means clear authority.

Modules may be distributed.

Authority should not be.

The roadmap should continuously protect:

* canonical workflows
* canonical mutation paths
* canonical runtime inspection
* canonical state ownership
* canonical terminology
* canonical architectural intent

The system should feel extensible without becoming incoherent.

## Required Inputs

When invoked, inspect available project context before editing `ROADMAP.md`.

Use any available sources such as:

* existing `ROADMAP.md`
* README files
* architecture docs
* recent commits
* changed files
* tests
* scripts
* issue notes
* implementation summaries
* failing commands
* current user request
* agent output logs
* TODOs or FIXME markers
* package/config changes

Do not rely only on the user's latest request if project artifacts are available.

Do not invent project state.

If evidence is missing, mark uncertainty explicitly.

## Per-Project Identity (DietCode native integration)

Every `roadmap` tool response is scoped to the **Hermes project workspace**, not
the DietCode plugin install tree. Read these fields before editing:

| Field | Use |
| --- | --- |
| `project_identity_line` | One-line header: project brief · stack · verify command |
| `project_steering_digest` | Entity card: CI, quality tools, governance, verify, bootstrap status |
| `project_fingerprint` | Raw signals in checkpoint `evidence` (README title, archetype, Makefile targets, …) |
| `bootstrap_fill_plan` | When template phrases remain — use `tasks[].suggested_replacement` |

Prefer evidence-backed replacements over generic text. When placeholders remain,
call `roadmap(action='apply_bootstrap_fill')` before manual edits.

Operator reference: `docs/roadmap.md` in the DietCode plugin tree.

Key doc sections for agents:

- **12-section schema** — required headings and enumerated health/soup values
- **Example payloads** — shape of `guide`, `checkpoint`, and `validate` responses
- **Bootstrap fill** — `bootstrap_fill_plan.tasks[].suggested_replacement`
- **Write guard** — ROADMAP.md only at `{workspace}/ROADMAP.md`
- **Anti-patterns** — backlog dumping, skipping §9 audit, plugin-tree writes

## Required Update Algorithm

Follow this sequence on every roadmap pass:

1. Read the existing `ROADMAP.md`, if present.
2. Identify the current stated center of gravity.
3. Inspect recent project changes and available evidence.
4. Determine whether the project is coherent, accelerating, drifting, fragmenting, blocked, or overloaded.
5. Compare current work against the existing roadmap.
6. Preserve valid strategic intent.
7. Remove duplicate or stale roadmap entries.
8. Archive items that no longer deserve active attention.
9. Promote items only when evidence supports promotion.
10. Demote items when uncertainty, risk, or entropy increases.
11. Add new items only when they connect to the center of gravity.
12. Rewrite technical implementation details into clear product and architecture language.
13. Run a centralization and code soup audit.
14. Update the recent checkpoint.
15. Add decision log entries for meaningful direction changes.
16. Return a concise summary of what changed.

## ROADMAP.md Required Structure

The file should use this structure.

```markdown
# ROADMAP.md

## 1. Project Center of Gravity

## 2. Roadmap Health

## 3. Strategic Narrative

## 4. Now

## 5. Next

## 6. Later

## 7. Discovery

## 8. Maintenance Gravity

## 9. Centralization & Code Soup Audit

## 10. Decision Log

## 11. Recent Checkpoint

## 12. Archive
```

Do not rename these top-level sections unless the user explicitly requests a different schema.

The consistency of the schema is part of the skill's value.

## Section Contract

### 1. Project Center of Gravity

Describe what the project fundamentally is.

This section should be understandable to a non-technical stakeholder while still useful to an engineer or agent.

Include:

```markdown
## 1. Project Center of Gravity

**Core Purpose:**  
<plain-language purpose>

**Primary Users / Operators:**  
<who uses or operates this system>

**Canonical Architecture:**  
<short description of the main architectural shape>

**Canonical Workflows:**  
<the main flows agents and humans should preserve>

**Primary Runtime / Operational Center:**  
<where operational truth lives>

**What This Project Must Not Become:**  
<anti-goals that protect coherence>
```

The "must not become" field is mandatory.

It prevents drift.

Examples:

* must not become a scattered collection of scripts
* must not become another generic AI IDE
* must not create multiple competing orchestration systems
* must not hide mutations behind invisible automation
* must not trade inspectability for convenience

### 2. Roadmap Health

Give the current health state.

Allowed statuses:

```text
Coherent
Accelerating
Drifting
Fragmenting
Blocked
Overloaded
Recovering
```

Use exactly one primary status.

Format:

```markdown
## 2. Roadmap Health

**Status:** Coherent / Accelerating / Drifting / Fragmenting / Blocked / Overloaded / Recovering

**Summary:**  
<brief explanation>

**Why This Status:**  
- <evidence>
- <evidence>
- <evidence>

**Primary Risk:**  
<single biggest risk>

**Primary Opportunity:**  
<single biggest opportunity>
```

### 3. Strategic Narrative

Explain what the project is becoming.

This should be short, clear, and directional.

Avoid vague hype.

Format:

```markdown
## 3. Strategic Narrative

<2-5 paragraphs explaining the current product / architecture direction>

The narrative should clarify:
- what changed recently
- what the system is converging toward
- what should be protected
- what should be avoided
```

### 4. Now

Active, committed, or already-in-motion work.

Only include items that are ready for execution or currently underway.

Do not include vague ideas.

Each item must use this format:

```markdown
### N. <Item Title>

**Goal:**  
<what this work accomplishes>

**Why It Matters:**  
<product, architecture, user, or maintenance value>

**Current State:**  
<known state from evidence>

**Next Concrete Action:**  
<one specific next action>

**Success Signal:**  
<how we know this worked>

**Gravity Impact:** Strengthens / Neutral / Weakens / Unknown  
**Centralization Effect:** Centralizes / No Change / Decentralizes  
**Entropy Risk:** Low / Medium / High  

**Risk / Mitigation:**  
<risk and mitigation>
```

Rules for Now:

* keep it small
* prefer 1-5 items
* each item must be actionable
* each item must have evidence
* each item must connect to the center of gravity

If there are more than 5 Now items, the roadmap is overloaded.

### 5. Next

Likely upcoming work.

These are prepared but not fully committed.

Format:

```markdown
### N. <Item Title>

**Opportunity:**  
<what could be unlocked>

**Why Soon:**  
<why this may matter after Now>

**Dependency:**  
<what must happen first>

**First Validation Step:**  
<smallest way to test whether this deserves promotion>

**Confidence:** High / Medium / Low  

**Gravity Impact:** Strengthens / Neutral / Weakens / Unknown  
**Centralization Effect:** Centralizes / No Change / Decentralizes  
**Entropy Risk:** Low / Medium / High
```

Rules for Next:

* do not pretend Next is committed
* include validation steps
* use confidence labels
* avoid implementation rabbit holes

### 6. Later

Long-horizon possibilities.

These are strategic directions, not promises.

Format:

```markdown
### N. <Direction Title>

**Direction:**  
<what this could become>

**Potential Upside:**  
<why it may matter>

**Why Not Now:**  
<why it remains deferred>

**Promotion Trigger:**  
<what evidence would move this into Next>

**Entropy Risk:** Low / Medium / High
```

Rules for Later:

* keep speculative work out of Now
* preserve interesting possibilities without letting them hijack execution
* include promotion triggers so Later does not become a junk drawer

### 7. Discovery

Questions, experiments, unknowns, and ambiguous ideas.

Discovery exists to protect the roadmap from false certainty.

Format:

```markdown
### N. <Question or Investigation>

**Question:**  
<what needs to be understood>

**Evidence Needed:**  
<what would clarify this>

**Possible Outcomes:**  
- <outcome>
- <outcome>
- <outcome>

**Decision Needed:**  
<what decision this discovery should eventually support>
```

Rules for Discovery:

* vague ideas belong here, not Now
* technical uncertainty belongs here
* product uncertainty belongs here
* architectural ambiguity belongs here

### 8. Maintenance Gravity

Track places where complexity, confusion, or fragility is accumulating.

Format:

```markdown
## 8. Maintenance Gravity

### Hotspots

| Area | Symptom | Risk | Recommended Action |
|---|---|---|---|
| <area> | <symptom> | Low/Medium/High | <action> |

### Repeated Friction

- <bug, workflow issue, agent confusion, or maintenance pattern>

### Documentation Gaps

- <missing or stale docs>

### Agent Confusion Points

- <places agents are likely to patch incorrectly>
```

Maintenance gravity is not shame.

It is early warning.

The purpose is to detect entropy before it becomes structural collapse.

### 9. Centralization & Code Soup Audit

Evaluate whether the project is becoming more or less coherent.

Use this checklist:

```markdown
## 9. Centralization & Code Soup Audit

**Overall Code Soup Risk:** Low / Medium / High

### Canonical Path Integrity

- Are there multiple ways to perform the same operation?
- Are there duplicate APIs, scripts, commands, or workflows?
- Is the correct path obvious?

**Assessment:**  
<answer>

### Authority Boundaries

- Where does runtime authority live?
- Where does state authority live?
- Where does mutation authority live?
- Where does diagnostic authority live?

**Assessment:**  
<answer>

### Structural Drift

- Did recent work introduce isolated patterns?
- Did it create one-off abstractions?
- Did it bypass existing architecture?

**Assessment:**  
<answer>

### Agent Coherence

- Would a future agent know where to patch?
- Would a future agent reuse the canonical path?
- Did recent work make agent behavior safer or more chaotic?

**Assessment:**  
<answer>

### Centralization Recommendation

<one recommendation to strengthen project gravity>
```

This section is mandatory.

If the roadmap does not audit code soup risk, the skill failed.

### 10. Decision Log

Record meaningful product, architecture, and workflow decisions.

Format:

```markdown
## 10. Decision Log

### YYYY-MM-DD — <Decision Title>

**Decision:**  
<what was decided>

**Reason:**  
<why>

**Impact:**  
<what changes because of this>

**Follow-up:**  
<what should happen next>
```

Rules:

* add entries only for meaningful decisions
* do not log every tiny change
* do not rewrite history casually
* preserve old decisions unless they are clearly obsolete
* if a decision is reversed, add a new entry instead of deleting the old one

### 11. Recent Checkpoint

Summarize the latest roadmap update.

Format:

```markdown
## 11. Recent Checkpoint

**Date:** YYYY-MM-DD

**Checkpoint Summary:**  
<what changed this pass>

**Moved:**  
- <item moved from one section to another>

**Added:**  
- <new item>

**Updated:**  
- <existing item updated>

**Archived:**  
- <archived item>

**Code Soup Risk:** Low / Medium / High  
<brief reason>

**Recommended Next Move:**  
<one concrete action>
```

Only one Recent Checkpoint should exist.

When updating, replace the previous Recent Checkpoint with the latest one.

Older meaningful changes should be preserved in the Decision Log or Archive.

### 12. Archive

The archive stores removed, deferred, killed, or superseded roadmap items.

Format:

```markdown
## 12. Archive

### <Archived Item>

**Archived Date:** YYYY-MM-DD  
**Reason:**  
<why it was removed from active attention>

**Restore Condition:**  
<what would justify bringing it back>
```

Rules:

* archive instead of deleting when strategic memory matters
* delete only if the item was duplicate, noise, or clearly useless
* archive stale speculative work
* archive work that weakens center of gravity without sufficient upside

## Roadmap Item Scoring

Every Now, Next, and Later item must include gravity metadata.

Use these exact labels.

### Gravity Impact

```text
Strengthens
Neutral
Weakens
Unknown
```

Meaning:

* Strengthens: reinforces the project center of gravity
* Neutral: does not meaningfully affect coherence
* Weakens: fragments authority, duplicates systems, or increases drift
* Unknown: not enough evidence yet

### Centralization Effect

```text
Centralizes
No Change
Decentralizes
```

Meaning:

* Centralizes: moves authority, diagnostics, workflow, or state closer to canonical surfaces
* No Change: does not affect centralization
* Decentralizes: creates new authority surfaces, parallel paths, or hidden behavior

### Entropy Risk

```text
Low
Medium
High
```

Meaning:

* Low: unlikely to create maintenance burden
* Medium: manageable but requires attention
* High: likely to create fragmentation, confusion, or long-term maintenance cost

## Promotion and Demotion Rules

### Promote Discovery to Next only when:

* the question is clear
* evidence exists
* the opportunity connects to the center of gravity
* the first validation step is known
* entropy risk is understood

### Promote Next to Now only when:

* dependencies are resolved
* the next action is concrete
* success signal is clear
* the work is aligned with current strategy
* the roadmap has capacity

### Demote Now to Next when:

* work is blocked
* confidence drops
* dependencies are missing
* implementation risk grows
* it no longer fits the current center of gravity

### Move anything to Archive when:

* it is stale
* it duplicates another item
* it weakens project gravity
* it belongs to an older strategy
* it is not worth preserving in active attention

## Anti-Bloat Rules

The roadmap must evolve by compression.

Do not allow `ROADMAP.md` to grow endlessly.

On every pass:

* merge duplicate items
* remove stale wording
* shorten old sections
* archive outdated ideas
* preserve only useful strategic memory
* keep Now small
* keep Next realistic
* keep Later intentional
* keep Discovery honest

If a section becomes too large, summarize it.

If an item has no next action, confidence, trigger, or evidence, it probably does not belong in Now or Next.

## Non-Technical Navigation Rules

The roadmap must be readable by non-technical users.

Use plain language first.

Technical details may appear only when they clarify direction, risk, or ownership.

Prefer:

```text
"Create one canonical patch pathway for agents."
```

Over:

```text
"Refactor RPC mutation handler abstractions across adapter modules."
```

The implementation details can live in issues, commits, or engineering docs.

The roadmap should explain why the work matters.

## Agent Governance Rules

Agents using this roadmap must optimize for coherence before completion.

Agents should:

* reuse existing architecture
* extend canonical systems
* preserve naming patterns
* avoid parallel workflows
* centralize diagnostics
* centralize mutation paths
* reduce hidden behavior
* improve inspectability
* document decisions
* archive stale ideas

Agents must avoid:

* inventing new architecture without justification
* creating duplicate utility layers
* creating local orchestration systems
* scattering state ownership
* hiding behavior behind convenience wrappers
* adding speculative roadmap items as commitments
* turning Discovery into Now without evidence
* treating the roadmap as a task dump

## Code Soup Detection Heuristics

Flag code soup risk when any of the following appear:

* multiple files doing the same job
* multiple commands for the same workflow
* multiple sources of truth
* repeated helper functions
* unclear ownership of state
* new abstractions with no clear gravity well
* duplicated configuration
* inconsistent naming
* hidden side effects
* new scripts bypassing canonical runtime behavior
* agents repeatedly patching the same area differently
* debugging requires jumping across unrelated systems

When detected, recommend convergence.

Convergence may mean:

* merge duplicate paths
* document the canonical path
* delete dead paths
* create a single command surface
* route behavior through the existing runtime
* centralize diagnostics
* collapse abstractions
* rename for clarity
* archive roadmap work that causes fragmentation

## Update Style

When editing `ROADMAP.md`:

* be concise
* be specific
* preserve useful history
* remove noise
* use stable headings
* avoid hype
* avoid generic PM language
* avoid massive bullet lists unless necessary
* prefer fewer, stronger items
* make uncertainty visible
* make next actions concrete

The tone should feel like a calm senior product strategist, staff engineer, and technical program manager reviewed the system together.

## Required Final Assistant Response

After updating or drafting `ROADMAP.md`, respond with this summary:

```markdown
## Roadmap Checkpoint Updated

**Health:** <status>

**Center of Gravity:**  
<one-sentence summary>

**Moved:**  
- <items moved between sections, or "None">

**Added:**  
- <new items, or "None">

**Updated:**  
- <updated items, or "None">

**Archived:**  
- <archived items, or "None">

**Code Soup Risk:** Low / Medium / High  
<brief reason>

**Recommended Next Move:**  
<one concrete action>
```

Do not include the full roadmap in the final response unless the user asks for it.

The final response should summarize the checkpoint, not duplicate the file.

## Failure Modes

This skill fails if it:

* creates a generic roadmap
* produces a giant backlog
* ignores center of gravity
* skips the code soup audit
* invents project state
* hides uncertainty
* promotes vague ideas into Now
* deletes strategic memory without reason
* decentralizes authority without mitigation
* makes the roadmap harder to read
* treats implementation activity as automatic strategic progress

## Success Definition

This skill succeeds when `ROADMAP.md` becomes the project's living steering checkpoint.

A successful roadmap should:

* preserve strategic memory
* clarify current direction
* prevent code soup
* expose maintenance gravity
* guide agents toward canonical paths
* make long-term development navigable
* help non-technical users understand what matters
* help technical users understand where changes belong
* reduce cognitive burden over time

The highest goal is not more planning.

The highest goal is sustained coherence under long-horizon, agent-assisted development.

## DietCode Plugin Integration

When the DietCode plugin is active:

1. Call `roadmap(action='guide')` to learn phase, health, `_roadmap_operator_hints`, and `agent_next_call`.
2. Call `roadmap(action='cockpit')` or `/roadmap cockpit` for a one-screen operator summary.
3. Call `roadmap(action='checkpoint', context=…)` before editing `ROADMAP.md` — returns evidence, `code_soup_pre_audit`, and the 16-step algorithm.
4. Call `roadmap(action='template')` when bootstrapping the first `ROADMAP.md` — returns `project_steering_digest` and `bootstrap_autofill_preview`.
5. When bootstrap template phrases remain, call `roadmap(action='apply_bootstrap_fill')` to preview evidence-backed replacements; pass `context='write'` to apply, then `roadmap(action='validate')`.
6. Use `project_steering_digest` and `bootstrap_fill_plan.tasks[].suggested_replacement` for per-project fill — each task maps template text to README/git/fingerprint evidence.
7. After editing, call `roadmap(action='validate')` to confirm schema compliance before finishing.
8. Call `roadmap(action='doctor')` to install the skill and run production health checks.
9. Call `roadmap(action='evidence')` for a read-only evidence bundle with `project_fingerprint`.
10. Call `roadmap(action='status')` to parse the current roadmap without mutating it.
11. Call `roadmap(action='explain_gate')` or `/roadmap explain-gate` when schema or freshness gates block progress (kernel explain-gate analogue).
12. Call `joyzoning(action='roadmap')` for a native cockpit brief inside governed sessions.

Workspace state persists at `.dietcode/roadmap-state.json` after each `validate` pass.

The skill file is installed to `optional-skills/dietcode/auto-rolling-roadmap/SKILL.md` in the workspace when `dietcode.roadmap.auto_install_skills` is enabled (default: true).

Operator smoke: `python scripts/roadmap_smoke.py` · `python scripts/roadmap_operator_smoke.py`
