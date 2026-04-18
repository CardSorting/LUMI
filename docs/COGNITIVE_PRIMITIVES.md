# Cognitive Memory Primitives (BroccoliDB)

The DietCode **Cognitive Memory Substrate** is powered by the **BroccoliDB** library—a graph-theoretic knowledge engine that enables high-fidelity grounding across complex, multi-agent reasoning chains. In V210, the substrate provides three specialized industrial primitives for managing change complexity and cognitive drift.

## 🧬 Cognitive Graph Basics

The substrate organizes knowledge into **Streams** (identified by `Stream ID`). A stream represents a coherent unit of work, such as a specific task, a git branch, or a subagent's temporary working memory.

### Stream Centrality
The system automatically calculates the "centrality" of files within a stream. Files with high centrality are the "Hubs" of your task and are prioritized during [Metabolic Pulse](JOYZONING_SOVEREIGNTY_3_0) monitoring.

---

## 🛠️ Industrial Tools (`MEM_*`)

### 1. `MEM_BLAST` (Radius Analysis)
The **Blast Radius** tool calculates the semantic impact of a change to a specific file or symbol. 
- **Input**: Target file/path and `maxDepth`.
- **Output**: A list of semantically related files that may be affected by the modification.
- **Industrial Use**: Use `MEM_BLAST` before large-scale refactors to identify potential side effects in distant modules.

### 2. `MEM_FORECAST` (Merge Risk Simulation)
The **Merge Forecast** tool simulates a "virtual merge" between two memory streams.
- **Input**: `sourceStreamId` and `targetStreamId`.
- **Output**: Risk level (🟢 LOW / 🔴 HIGH), a list of direct file conflicts, and identified **Semantic Overlaps**.
- **Industrial Use**: Run a forecast before finalizing a subagent's task to ensure its "Grounded Truth" aligns with the current state of the parent core.

### 3. `MEM_CHOKE` (Chokepoint Detection)
The **Chokepoint Detection** tool identifies architectural bottlenecks in the project history.
- **Input**: `limit` (max results).
- **Output**: A list of files with high "score/churn" that represent the most fragile points in the codebase.
- **Industrial Use**: Use `MEM_CHOKE` to identify candidates for [Industrial Fission (Sovereign Decomposer)](JOYZONING_SOVEREIGNTY_3_0).

---

## 🔍 Forensic Primitives

| Tool | Industrial Command | Role |
| :--- | :--- | :--- |
| **Claim** | `mem_claim` | Lock a specific knowledge stream for exclusive agentic modification. |
| **Refresh** | `mem_refresh` | Trigger a substrate-wide re-indexing of the current focus chain. |
| **Snapshot** | `mem_snapshot` | Create a Merkle-mapped binary snapshot of the current cognitive state. |

---

## 🧬 Axiomatic Grounding
The Cognitive Memory substrate enforces the **Axiom of Grounding**. Agents are blocked from performing `attempt_completion` if their internal "Cognitive Focus" (🧠) lacks verified grounding in the current memory streams.

> [!TIP]
> **Context Uncertainty**: If you feel your reasoning is drifting, invoke `MEM_REFRESH` to re-align your cognitive state with the physical substrate.
