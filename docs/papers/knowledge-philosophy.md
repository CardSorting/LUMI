{/* [LAYER: INFRASTRUCTURE] */}

# Workspace Knowledge: The Philosophy of Advisory Memory

*Advisory design principles for robust agent cognition.*

> **Related:** [Knowledge Thesis](knowledge-thesis.md) · [Knowledge Brief](knowledge-brief.md) · [Knowledge Whitepaper](knowledge-whitepaper.md) · [README](README.md)

---

## I. Observability Over Enforcement

We believe that **enforcement is the job of the human and the host, not the memory**.

When an agent learns about the codebase:
- It **records** findings to help guide future actions.
- It **advises** the developer of stability, churn, and risk.
- It **never blocks** task completion based on incomplete or failing knowledge updates.

The primary duty of Workspace Knowledge is to **inquire and suggest**, not to command. When the knowledge system itself fails — through corruption, filesystem limits, or database locks — the task must continue to succeed. A failure to update memory is a warning to be logged, not an incident to stop the line.

---

## II. The Seatbelt Principle

Cognitive memory must act as an **observability seatbelt** and a **black box flight recorder**:
1. **Survive the Crash:** If the JSON model is corrupted, the system falls back to a clean starting state, logs a structured parser warning, and regenerates facts.
2. **Accept Write Blockage:** If the disk is full or the environment is read-only, the engine logs the degraded write failure to diagnostics, skips updating disk files, and reports the error.
3. **Isolate State Issues:** In-memory calculations (like fact merging and deduplication) must resolve conflicts internally without raising uncaught exceptions that leak into the task lifecycle.

A memory system that crashes when it cannot write is not a helper; it is a liability.

---

## III. Provenance as Ground Truth

An agent's belief is only as strong as its evidence:
- **No Unbacked Assumptions:** A fact cannot exist in the model without a corresponding `WorkspaceProvenance` collection linking it back to task runs, git commits, or physical files.
- **Dynamic Lifecycle Management:** Facts are not static. They transition from `active` to `stale` or `superseded` when new task runs verify changes.
- **Auditability:** Every fact is explainable. The system can trace a claim from its current lifecycle state, through its confidence status (`confirmed | needs_verification`), back to the raw execution logs.

By grounding beliefs in physical evidence, we prevent memory drift and hallucination, maintaining high-fidelity orientation across task boundaries.
