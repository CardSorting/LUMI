# Spider Engine 4.0: Modular Structural Analysis

The `spider` package is the core diagnostic engine for DietCode's architectural sovereignty. It maintains a high-fidelity structural graph of the codebase, enabling real-time detection of layer violations, ghost imports, and architectural decay.

## Package Architecture

The engine is decomposed into specialized sub-engines to ensure performance, testability, and separation of concerns:

### [Facade] [SpiderEngine.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/spider/SpiderEngine.ts)
The primary entry point. Orchestrates the sub-engines and provides high-level APIs for:
- Building and updating the structural graph.
- Generating integrity violations and entropy reports.
- Forecasting the impact of proposed changes (Simulation).
- Exporting structural visualizations (Mermaid diagrams).

### [Logic] [PathResolver.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/spider/PathResolver.ts)
Responsible for mapping spectral imports to physical file IDs:
- Resolves TypeScript aliases (`@/`, `@core`).
- Detects architectural layers based on physical location and tags.
- Maintains a resolution cache to stay within mission-critical performance budgets.

### [Forensics] [ForensicEngine.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/spider/ForensicEngine.ts)
The "Ghost Buster" of the substrate:
- Detects symbols that are imported but no longer exist in the registry.
- Provides move-aware analysis to prevent false-positive alarms during large refactors.

### [Metrics] [MetricsEngine.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/spider/MetricsEngine.ts)
The mathematical heart of the system:
- Calculates **Logic Density**, **I/O Entropy**, and **AST Complexity**.
- Performs reachability analysis to identify orphaned nodes.
- Detects circular dependencies within the structural graph.

### [Persistence] [PersistenceManager.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/spider/PersistenceManager.ts)
Ensures structural truth survives between sessions:
- Implements atomic write operations to prevent registry corruption.
- Uses high-performance V8 serialization (`.spiderbin`) for indexing.
- Manages a rolling buffer of architectural snapshots for rollback proposals.

## Data Structures

Shared types and interfaces are defined in [types.ts](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/spider/types.ts), ensuring absolute type-safety across the modular suite.

## Usage

```typescript
const engine = new SpiderEngine(cwd);
await engine.loadRegistry();

// Update a node after a file edit
engine.updateNode("src/core/MyFile.ts", content);

// check for architectural violations
const violations = engine.getViolations();
```
