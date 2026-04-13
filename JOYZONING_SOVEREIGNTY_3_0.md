# JoyZoning 3.0: Sovereign Autonomy Architecture

JoyZoning 3.0 represents a pivot from passive architectural enforcement to an **Active Sovereignty** model. The codebase is no longer just a collection of files; it is a self-aware substrate that enforces its own structural integrity through fingerprinting, design axioms, and autonomous healing.

## 1. The Fingerprinting Engine (Spider 3.0)

The core diagnostic layer now uses **Archetypal Fingerprinting** to detect structural misfits. Every module in the `src` directory is profiled across three key dimensions:

| Metric | Definition | High Threshold (Smell) |
| :--- | :--- | :--- |
| **Logic Density** | AST nodes (If/For/Switch/While) per total nodes. | > 15% (Infrastructure) |
| **I/O Entropy** | Percentage of platform/node imports vs pure imports. | > 20% (Domain/Core) |
| **AST Complexity** | Total count of unique AST nodes in the file. | > 500 (Plumbing) |

### Sovereign Archetypes by Layer

The [SovereignOptimizer](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SovereignOptimizer.ts) uses these fingerprints to recommend migrations:
- **DOMAIN**: Must be **Pure**. `ioEntropy` should be 0%. High `logicDensity` expected.
- **INFRASTRUCTURE**: Must be **Simple Adapters**. Low `logicDensity`, high `ioEntropy`.
- **PLUMBING**: Must be **Stateless**. Low `complexity`, focused purely on utility functions.
- **CORE**: Must be **Interpreters**. Orchestrates Domain logic; should have medium `logicDensity` and zero `IO`.

## 2. Axiomatic Sovereignty (Design Axioms)

The [SemanticAxiomEngine](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SemanticAxiomEngine.ts) enforces mathematical-grade design truths:

- **Axiom of Statelessness**: Any file tagged `[LAYER: PLUMBING]` is blocked from declaring mutable top-level variables (`let` or `var`). Utilities must be stateless pure functions.
- **Axiom of Interface Segregation**: A Core module is flagged as a "Fat Coordinator" if it depends on more than 5 distinct infrastructure adapters. It must be refactored into focused services.
- **Axiom of Dependency Inversion**: Domain and Core logic layers are strictly blocked from importing concrete implementation files. They must only depend on abstract interfaces (e.g., `import { IStorage }` vs `import { LocalStorage }`).

## 3. Autonomous Sovereign Healing (`arch_heal`)

The [ArchitectureHealTool](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/ArchitectureHealTool.ts) is the primary engine for structural restoration. It supports multi-file cascading refactors:

- **`extract_interface`**:
    1. Detects public methods in a concrete class.
    2. Generates a matching `I[ClassName].ts` interface.
    3. Updates the original class to implement the interface.
    4. Swaps all project-wide references to depend on the abstraction.
- **`stabilize`**:
    1. Runs **Canonicalization** (fixing relative imports to `@` aliases).
    2. Runs **Tag Alignment** (ensuring the `[LAYER: ...]` matches the file's physical location).
    3. Triggers optimization suggestions based on the current fingerprint.

## 4. Integrity Projections (The Simulator)

The [SimulationEngine](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SimulationEngine.ts) provides a "Pre-flight Prophet" that forecasts the architectural future.

- **Drift Forecast**: Projects the **Integrity Score** impact of a proposed change. If a move or edit would drop global integrity by > 10%, the operation is warned or soft-locked.
- **Archetype Prediction**: Before a file is moved to a new layer, the simulator checks if its current fingerprint is compatible with the target layer's archetype.

---

## 🔍 Auditing Logic 3.0

When performing an architectural audit, the system generates a **DoctorReport** which includes:
1. **Fever Map**: Files with high doubt signals (loops/re-reads).
2. **Archetype Mismatch List**: Modules physically located in one layer but behaving like another.
3. **Axiom Violations**: Direct breaches of structural constraints.
4. **Agent Success Rate**: Persistent tracking of how often the AI adheres to these rules vs. attempts to bypass them.

> [!CAUTION]
> **Substrate Integrity Score < 70**: Triggers the **Architectural Alarm**. In this state, the agent is restricted to `HEAL` operations only until sovereignty is restored.
