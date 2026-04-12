# 🕷️ Spider Structural Intelligence Engine

The **Spider Engine** is a high-performance structural analysis system integrated into the core database and the Fluid Policy Engine. It uses Abstract Syntax Tree (AST) parsing to build a comprehensive dependency graph of the codebase, enabling proactive architectural enforcement, entropy detection, and automated refactoring.

> [!TIP]
> For a deep dive into the philosophy and principles behind the engine, see [Spider Theory: Structural Entropy & Architectural Sovereignty](file:///Users/bozoegg/Downloads/cline-main/src/core/policy/SPIDER_THEORY.md).

## 🏗️ Architecture

The Spider ecosystem is composed of several specialized services:

| Component | Responsibility |
| :--- | :--- |
| `SpiderEngine` | Core graph analysis, AST parsing (`ts-morph`), entropy scoring, and Mermaid visualization. |
| `SpiderService` | Database integration, bootstrapping from repository heads, and snapshot persistence. |
| `StructuralDiscoveryService` | High-level insights including **Blast Radius** analysis and file **Centrality Score**. |
| `SpiderRefactorer` | Heuristic-based remediation (MOVE, DELETE) to resolve architectural smells. |
| `SpiderPersistence` | High-performance graph serialization and Database head bootstrapping. |

## 🛠️ Performance & Hardening

The engine has been hardened for production-level workloads:

1.  **Memory Hardening**: Aggressive AST purging via `ts-morph` SourceFile removal immediately after metadata extraction. This prevents memory leaks in workspaces with >10,000 files.
2.  **Reachability Bypass**: The BFS reachability analysis is protected by a structural change guard. It only recomputes if a node's `imports` have actually changed, saving 90% of structural audit CPU time during rapid iterations.
3.  **Bootstrap Persistence**: Initial graph construction is cached in the database, enabling O(1) cold starts for architectural context gathering.

## 📊 Metrics & Entropy

Spider quantifies the "architectural health" of the codebase using a weighted entropy score (0.0 to 1.0):

1.  **Depth Score (30%)**: Penalizes deeply nested directory structures (limit > 4).
2.  **Naming Score (20%)**: Enforces project-wide `kebab-case` naming conventions.
3.  **Orphan Score (20%)**: Identifies files unreachable from root layers (UI, Core, entry points).
4.  **Coupling Score (30%)**: Detects illegal cross-layer dependencies (e.g., Domain importing Infrastructure).

## 🛡️ Integration

### Fluid Policy Engine
The Spider Engine provides real-time "Architectural Decay" detection. If an agent write increases the global entropy score significantly (delta > 0.01), a warning is injected into the development cycle.

### Native Database Knowledge

Structural snapshots are persisted as Database Knowledge Items (`structural_snapshot` type). These snapshots allow the system to track the structural evolution of the codebase over thousands of commits.

### Oracle Suggestion Engine (Consumer)
The **Oracle Grade Suggestion Engine** is a primary consumer of Spider intelligence. It utilizes the `SpiderEngine` and `StructuralDiscoveryService` to:
- Perform **Smart Symbol Expansion**: Resolving symbols for diagnostic resolution project-wide.
- Enforce **Joy-Zoning Policy**: Ensuring suggestions do not increase structural entropy.
- See [SUGGESTION_ENGINE.md](../suggestion/SUGGESTION_ENGINE.md) for implementation details.

## 🛠️ Usage

### Analyzing Blast Radius
The `StructuralDiscoveryService` can calculate the impact of a change before it's even planned:
```typescript
const impact = spiderService.getDiscovery().getBlastRadius("src/core/policy/SpiderEngine.ts");
console.log(impact.centralityScore); // High centrality = High risk
```

### Proactive Visualization
Spider can generate Mermaid.js diagrams of the current structural graph, useful for documenting complex service correlations during plan assembly.
