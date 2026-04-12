# SPIDER: Structural Path Integrity & Dependency Evolution Report

Spider is an advanced architectural analysis engine designed to monitor and enforce structural health within a repository. It treats the codebase as a directed graph where nodes are files and edges are imports.

## Core Metrics

### 1. Entropy Score
A composite metric (0.0 to 1.0) representing the architectural "chaos" of the system.
- **Path Depth**: Penalizes deeply nested file structures.
- **Naming Consistency**: Monitors adherence to project naming conventions (e.g., kebab-case).
- **Orphan Ratio**: Tracks unreachable code that adds cognitive load without functional value.
- **Coupling Density**: Measures cross-layer pollution (e.g., Domain layer importing Infrastructure).

### 2. Reachability
Spider identifies "root" files (UI entries, core index files) and performs a graph traversal to find orphaned nodes.

### 3. Layer Enforcement
Using "Joy-Zoning" rules, Spider ensures that dependencies only flow in allowed directions (e.g., Infrastructure can import Domain, but not vice-versa).

## Usage in BroccoliDB

Spider is integrated into BroccoliDB as a persistent structural observer. Snapshots are stored as Knowledge nodes, allowing agents to reason about high-level architectural state.

```typescript
const structuralMetadata = await agentContext.getLatestStructuralMetadata();
if (structuralMetadata.entropy > 0.4) {
  // Suggest refactoring to reduce entropy
}
```
