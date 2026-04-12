# Archival & Deprecation: Grounding & Multi-Agent System (MAS)

This document formally records the architectural findings that led to the full removal of the **Intent Grounding** pipeline and the **Multi-Agent System (MAS)** infrastructure from CodeMarie in v3.85.0.

## 🧐 The Findings

The Grounding and MAS systems were originally designed to ensure high-fidelity architectural alignment by introducing a multi-layered peer-review and validation process before any code execution. However, during production hardening, a critical failure mode was identified: **Execution Deadlock via Recursive Uncertainty.**

### 1. The Grounding Loop Failure
The grounding system attempted to "hyper-ground" every intent by recursively validating prerequisites. This created a non-terminating pattern:
1. **Validate Intent**: The system detects a potential ambiguity.
2. **Re-Ground**: A sub-agent is spawned to resolve the ambiguity.
3. **New Uncertainty**: The resolution itself introduces new entities that require grounding.
4. **Infinite Loop**: The system stalls indefinitely, unable to proceed to the actual execution phase.

### 2. MAS Orchestration Stalls
The Multi-Agent System (MAS) was tightly coupled with this grounding logic. Because MAS acted as a hard execution gate, any failure or delay in the grounding pass propagated system-wide, leading to "Agent Stalls" where the user saw no progress for minutes, followed by a timeout or crash.

## 📉 Structural Analysis of Failure

| Failure Dynamic | Description |
| :--- | :--- |
| **Recursive Uncertainty** | Each grounding pass increased complexity rather than reducing it. |
| **Execution Gating** | Grounding was a synchronous prerequisite, blocking all forward progress. |
| **Orchestration Bloat** | The cognitive overhead of managing sub-agent consensus exceeded the benefits of the reviews. |
| **Non-Termination** | Lack of bounded exit conditions allowed for indefinite stalls in complex workspaces. |

## 🛠️ Removal Rationale (vs. Refactor)

A refactor (e.g., adding timeouts or confidence thresholds) was considered but rejected for the following reasons:
- **Heuristic Fragility**: Thresholds are difficult to tune across diverse repository structures.
- **Architectural Debt**: The grounding code paths were deeply intertwined with the core task loop, making partial fixes risky.
- **Goal Alignment**: CodeMarie's primary objective is **autonomous execution with reliability**. A system that can halt indefinitely is fundamentally incompatible with this goal.

## 🏗️ New Architectural Direction: Observe-Act-Adjust

Following the removal of these layers, CodeMarie has moved to a simplified, high-throughput execution model:

1. **Observe**: Gather immediate context from BroccoliDB, Spider Engine, and Diagnostics.
2. **Act**: Propose a plan and execute tool calls with built-in policy guards (`UniversalGuard`).
3. **Adjust**: Use the feedback from tool outputs and diagnostics to refine the state in the next turn.

This "Closed-Loop feedback" replaces the "Open-Loop grounding" and ensures that the system always makes forward progress.

---
*For more information on the current architectural enforcement, see [ARCHITECTURAL_ENFORCEMENT_HARDENING.md](../ARCHITECTURAL_ENFORCEMENT_HARDENING.md).*
