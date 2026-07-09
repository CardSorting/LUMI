<!-- [LAYER: INFRASTRUCTURE] -->

# Companion Brief: Workspace Knowledge System

*An executive summary of LUMI's advisory workspace memory substrate.*

> **Related:** [Knowledge Thesis](knowledge-thesis.md) · [Knowledge Philosophy](knowledge-philosophy.md) · [Knowledge Whitepaper](knowledge-whitepaper.md) · [README](README.md)

---

## What is Workspace Knowledge?

Workspace Knowledge is LUMI's **durable cognitive memory layer**. Instead of relying on raw chat history or fragile vector embeddings to remember project details, LUMI builds a structured, typed model of the workspace after each completed task.

```
Task Execution ──► Task Finalization ──► learnFromFinalization()
                                                │
                                                ▼
Next Task Context ◄── getKnowledgeHealth() ◄── Projections on Disk
```

---

## Key Pillars

### 1. The Six Projections
The system tracks six key areas of project state:
- **Subsystem Stability:** Maps stable vs. high-churn volatile directories.
- **Architectural Decisions:** Logs ADR status and architectural progression.
- **Stale Documentation:** Points out documentation surfaces requiring review.
- **Recurring Risk Areas:** Identifies high-risk directories and code surfaces.
- **Handoff Facts:** Compiles key facts required for transition to the next agent.

### 2. Provenance Tracking
Every fact contains a list of proof records indicating **why** the system believes it. It tracks files modified, the task run ID, the commit hash, and the exact timestamp. When state changes (e.g. a subsystem becomes stable), the fact is marked `superseded` and updated with a fresh provenance link.

### 3. The Observability Seatbelt (Fault-Tolerance)
Memory updates are completely **advisory and non-blocking**. If a file write fails (disk full) or a JSON file is corrupted, the system logs structured JSON warnings to `diagnostics.jsonl`, fallback renders the wiki page, and allows the task to successfully finish.

---

## Developer Ergonomics
- **Human-Readable Dashboard:** View health status, recovery hints, and log entries directly at `.wiki/intelligence/workspace-intelligence.md`.
- **Query APIs:** Programmatic access via `WorkspaceIntelligenceReader` allows downstream tools and subagents to query health, ADR history, and directory volatility.
