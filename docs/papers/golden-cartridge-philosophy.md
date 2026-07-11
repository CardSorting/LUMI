{/* [LAYER: INFRASTRUCTURE] */}

# Golden Cartridge: The Philosophy of Finite Resources

*Advisory design principles for resource-constrained, high-efficiency developer agent behavior.*

> **Related:** [Golden Cartridge Brief](golden-cartridge-brief.md) · [Golden Cartridge Whitepaper](golden-cartridge-whitepaper.md) · [Tools Reference](../tools-reference/golden-cartridge.mdx) · [README](README.md)

---

## I. The Paradigm of Finite Capacities

We operate under a simple truth: **no system has infinite capacity.** 

In modern software engineering, when an AI agent is tasked with modifying a codebase, it behaves as if its environment has infinite resources:
* It reads full-file structures repeatedly, consuming thousands of tokens.
* It invents new helper classes, utility functions, or state variables, expanding the codebase's surface area.
* It executes massive test suites or runs continuous terminal commands, wasting developer time and host CPU cycles.

The Golden Cartridge rejects this expansionist approach. We believe that **efficiency, clarity, and minimalism are the highest forms of architectural discipline.** Every agent action must optimize for verified engineering value per unit of resource cost.

---

## II. The One-Way Facade Invariant

A core architectural principle of the Golden Cartridge is the **one-way dependency boundary**.

* **Golden Cartridge may call core subsystems**: The facade acts as a coordinator, composing existing tools (such as `project_map`, `search_files`, `apply_patch`, and `execute_command`) into high-information, low-mass packages.
* **Core subsystems must never depend on the Golden Cartridge**: The core toolset, execution loops, and memory drivers must remain completely oblivious to the facade's existence.

```
┌──────────────────────────────────────────────────────────┐
│              GOLDEN CARTRIDGE (Facade Layer)             │
│   trace  ·  slice  ·  find_reuse  ·  patch_smallest ...   │
└───────────────────────────┬──────────────────────────────┘
                            │ (one-way dependency)
                            ▼
┌──────────────────────────────────────────────────────────┐
│                 CORE SYSTEM (Agent Loop)                 │
│   project_map  ·  search_files  ·  apply_patch  ·  bash   │
└──────────────────────────────────────────────────────────┘
```

This structural separation ensures that the Golden Cartridge is a **pure overlay**. If it is removed, the core agent's capabilities remain fully intact. The facade adds vocabulary and coordination only—never authority, rules, or permission constraints.

---

## III. Ground Truth over Optimistic Beliefs

An agent should never believe its changes are correct simply because "it compiled them." 
We base correctness on **revision-locked physical evidence**:

1. **Classified Outcomes**: A validation check is classified based on structured execution metrics—exit codes, execution signals, execution timeouts, and duration—rather than parsing optimistic terminal text logs.
2. **Revision Invalidation**: When a patch is applied, the agent's cached beliefs about the codebase are invalidated. The evidence must be rebuilt for the new revision.
3. **Stale Risk Disclosure**: If changes occur outside of the agent's tracking (e.g., manual edits by a human developer), the cache remains stale until an explicit refresh occurs. The agent must acknowledge this boundary rather than assuming static correctness.

---

## IV. The Smallest Authoritative Patch

The goal of software evolution is to implement requirements with the **smallest possible permanent-surface modification**. 

When proposing a code change:
* We prioritize **reuse** over invention.
* We prefer **compact representations** over new abstractions.
* We design the **smallest patch** that satisfies the requirement, rather than the fewest characters.
* We select the **cheapest relevant check** capable of disproving the change, rather than running blanket validation.

By keeping the modification surface minimal, we reduce the cognitive load on human reviewers, keep the context window clear of bloat, and prevent the gradual decay of codebase architecture.
