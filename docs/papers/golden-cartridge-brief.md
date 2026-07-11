{/* [LAYER: INFRASTRUCTURE] */}

# Companion Brief: Golden Cartridge Protocol

*An executive summary of LUMI's resource-constrained, high-information development workbench.*

> **Related:** [Golden Cartridge Philosophy](golden-cartridge-philosophy.md) · [Golden Cartridge Whitepaper](golden-cartridge-whitepaper.md) · [Tools Reference](../tools-reference/golden-cartridge.mdx) · [README](README.md)

---

## What is Golden Cartridge?

The **Golden Cartridge Protocol** is a development methodology and tool facade integrated into LUMI. It is designed to guide agentic behaviors toward **high-information, low-mass engineering paths**. 

Instead of reading massive file structures or generating overly complex code changes, the Golden Cartridge workflow restricts operations to surgical reads, canonical reuse, compact state representation, and targeted validation checks.

```
                  ┌───────────────────────────────┐
                  │   Golden Cartridge Protocol   │
                  └───────────────┬───────────────┘
                                  ▼
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
  Surgical Scope           Canonical Reuse          Evidence Receipt
 (Trace / Slice /        (Find Reuse / Design       (Disprove / Seal)
    Compress)                  Compact)
```

---

## The Core Value Proposition

In large-scale web and software development, agentic workflows face three primary limitations:
1. **Context Window Saturation**: Over-reading files fills the context window with irrelevant details, leading to reasoning degradation.
2. **Architecture and State Bloat**: Agents tend to "invent" new helpers, state, or modules rather than reusing existing abstractions.
3. **Execution Overhead**: Running complete integration test suites or full system compilations is slow and costly.

Golden Cartridge resolves these challenges by introducing a **one-way facade** composed of twelve verbs. This facade guides the model to observe, design, mutate, and validate only what is strictly necessary.

---

## Key Pillars

### 1. Context Budgeting (Trace, Slice, Compress)
Golden Cartridge assumes that model attention is a finite resource.
- **Trace**: Identifies the exact dependency route before traversing directories.
- **Slice**: Loads only the target symbol definitions and direct lexical context.
- **Compress**: Actively releases stale context and summarizes current findings.

### 2. Canonical Reuse (Find Reuse, Design Compact)
Before writing any code, the agent is directed to explore existing logic.
- **Find Reuse**: Searches the codebase for existing patterns and behavior to avoid reinventing wheels.
- **Design Compact**: Analyzes alternative representations to merge duplicate state and logic.

### 3. Verification & Evidence (Disprove, Seal)
Validation is based on physical ground-truth results rather than optimistic text logs.
- **Disprove**: Discovers and runs only the minimal set of unit tests or checks that can disprove the correctness of a change.
- **Seal**: Produces a non-authoritative handoff receipt compiling acceptance requirements, executed tests, and remaining risks.

---

## Developer and Business Impact

* **Reduced LLM Costs**: Surgical context loading minimizes token consumption, resulting in 40–60% lower API bills per task.
* **Higher Review Velocity**: Smaller, cleaner patches (via `patch_smallest`) decrease the burden on human reviewers.
* **Safer Deployments**: Revision-locked validation caching ensures that tests are automatically rerun if the code changes, preventing regression drift.
