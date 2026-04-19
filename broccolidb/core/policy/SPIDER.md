# SPIDER: Structural Path Integrity & Dependency Evolution Engine (V15+)

Spider is a high-fidelity architectural substrate designed for autonomous agentic environments. It transitions the codebase from a loose collection of files into a **Deterministic Symbolic Graph**, allowing for forensic-grade structural analysis and self-healing refactoring.

## 🏗️ Core Architecture (V15 Graduation)

The engine has been modularized into specialized components to achieve maximum performance and memory safety:

- **MetricsEngine**: Calculates **Entropy** and evaluates **SCC (Strongly Connected Components)** using Tarjan's algorithm for deep multi-hop cycle detection.
- **SymbolRegistry**: The source of truth for **Symbolic Anchoring**. Maps exported symbols (Classes, Interfaces, Types) to their providers, eliminating heuristic-based dependency detection.
- **ForensicEngine**: Performs deep-symbol verification, distinguishing between concrete (Class/Method) and abstract (Interface/Type) dependencies.
- **PersistenceManager**: Handles atomic **Binary-Lite Serialization** (`.spiderbin`) for near-instantaneous state recovery.

## 🧠 Strategic Pillars

### 1. Symbolic Anchoring (New)
Instead of simple file-to-file imports, Spider anchors the graph to unique **Exported Symbols**. This enables:
- **Symbolic Traceback**: Identifying the exact symbol causing a blast-radius dependency.
- **Contract Verification**: Ensuring that moving or renaming a symbol satisfies all incoming dependents before commitment.

### 2. High-Fidelity Incrementalism
Spider leverages the Repository's Tree-CAS system to perform **Tree-Diff Bootstrapping**.
- **Performance**: Instantaneous updates by comparing the Tree-Hash of the cached commit vs. the current HEAD. Only modified symbols are re-processed.

### 3. Deep Circular Detection
Using **Tarjan's SCC Algorithm**, Spider detects complex architectural loops (A → B → C → A) that standard linters miss. Multi-hop circularity is penalized heavily in the Entropy Score.

### 4. Atomic Mutation Security
Structural updates are serialized via a **TaskMutex Mutation Guard**. This prevents graph corruption in concurrent multi-agent environments where multiple tool-calls may attempt to modify the substrate simultaneously.

## 📊 Architectural Health Metrics

| Metric | Anchor | Target |
| :--- | :--- | :--- |
| **Entropy** | System Complexity | < 0.3 |
| **Stability** | Concrete vs. Abstract | High Abstract Ratio |
| **Reachability** | Path Connectivity | Zero Orphans |
| **Centrality** | Component Importance | Avoid "Structural Volcanoes" |

## 🛠️ Strategic Refactoring (SpiderRefactorer)

Spider provides automated guidance for structural hardening:
- **`SQUASH_CYCLE`**: Surgical removal of multi-hop circularity.
- **`DECOUPLE`**: Suggests Inversion of Control (IoC) when concrete coupling crosses layer boundaries.
- **`MOVE` / `DELETE`**: Continuous alignment with **Joy-Zoning** layering rules.

## 🛰️ Integration in BroccoliDB

Spider is the "Proprioception" of the agent. It is used in the `AuditService` to block high-impact mutations and in the `SuggestionService` to provide long-term architectural health strategies.

```typescript
// Deterministic Blast Radius Check
const radius = spider.getBlastRadius('src/core/auth.ts');
if (radius.centralityScore > 0.4) {
  Logger.warn(`Structural Pillar detected. Traceback: ${JSON.stringify(radius.traceback)}`);
}
```
