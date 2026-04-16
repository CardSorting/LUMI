# JoyZoning 3.0: Sovereign Autonomy Architecture

JoyZoning 3.0 represents a pivot from passive architectural enforcement to an **Active Sovereignty** model. The codebase is no longer just a collection of files; it is a self-aware substrate that enforces its own structural integrity through fingerprinting, design axioms, and autonomous healing.

## 1. The Fingerprinting Engine (Spider 4.0)

The core diagnostic layer now uses **Archetypal Fingerprinting** to detect structural misfits. Every module in the `src` directory is profiled across three key dimensions:

| Metric | Definition | High Threshold (Smell) |
| :--- | :--- | :--- |
| **Logic Density** | AST nodes (If/For/Switch/While) per total nodes. | > 15% (Infrastructure) |
| **I/O Entropy** | Percentage of platform/node imports vs pure imports. | > 20% (Domain/Core) |
| **AST Complexity** | Total count of unique AST nodes in the file. | > 500 (Plumbing) |

### Modular Sovereignty (Package: `src/core/policy/spider/`)

In V15, the Spider Engine graduated from a monolithic class to a specialized package structure, orchestrating several domain-specific engines:

- **PathResolver**: High-performance layer detection and alias resolution.
- **ForensicEngine**: Proactive "ghost symbol" detection and move-aware graph verification.
- **MetricsEngine**: Mathematical calculation of Logic Density, I/O Entropy, and Reachability.
- **PersistenceManager**: Atomic binary serialization (`.spiderbin`) for high-integrity registries.

This decomposition ensures that the substrate diagnostic layer is as maintainable and testable as the Domain logic it protects.

### Sovereign Archetypes by Layer

The [SovereignOptimizer](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SovereignOptimizer.ts) uses these modular signals to recommend migrations:
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

The [SovereignGarbageCollector](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SovereignGarbageCollector.ts) implements **Reactive Structural Stabilization**. It represents a pivot from predictive guessing to error-driven forensic repair:

- **Reactive stabilization**: Structural heals, export pruning, and circular dependency mitigation are triggered strictly by verified build violations (TSC/Biome). This prevents agentic spiraling caused by hypothetical substrate predictions.
- **Industrial Member Mapping**: The [RefactorHealer](file:///Users/bozoegg/Downloads/codemarie-new/src/core/task/tools/RefactorHealer.ts) physically extracts method/property signatures from provider modules using AST traversal to synthesize perfectly compatible stubs.
- **Transparent Logging**: Every substrate repair is now recorded in a forensic `repairLog`, providing full traceability into autonomous substrate healing.

## 4. The Sovereign Metabolism (V140)

The metabolic layer is now **Data-Driven**, calculating energy consumption based on physical structural improvement:

- **Metabolic Velocity**: Turn velocity is adaptive. High-quality refactors (Naming Integrity > 0.9) grant **Velocity Expansion**, reward system structural hardening.
- **Immune-Driven Hardening**: Integrated with the **PathogenStore**. Modules with high failure rates (Pathogens) undergo **Focused Forensic Audits**, enforcing 100% structural purity during reactive sweeps.

## 5. Substrate Immortality & Axiomatic Drift

The architectural truth is now self-healing and continuously monitored:

- **Self-Healing Registry (V93)**: If the project registry is lost or corrupted, the system autonomously performs a full recursive re-indexing of the substrate.
- **Axiomatic Drift Sensing**: Real-time ratio tracking of pure-layer imports vs. cross-layer leakage. Drift scores are reported in every audit to prevent gradual structural erosion.

The [SimulationEngine](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SimulationEngine.ts) provides a "Pre-flight Prophet" that forecasts the architectural future.

- **Drift Forecast**: Projects the **Integrity Score** impact of a proposed change. If a move or edit would drop global integrity by > 10%, the operation is warned or soft-locked.
- **Archetype Prediction**: Before a file is moved to a new layer, the simulator checks if its current fingerprint is compatible with the target layer's archetype.

---

## 🔍 Auditing Logic 3.0: Total Forensic Realism

When performing an architectural audit, the system generates a **DoctorReport** powered by **Forensic Realism**:
1. **Fever Map**: Accurate detection of structural stagnation and high coupling density.
2. **Metabolic Exhaustion**: Real-time sensing of agentic fatigue and loop detection.
3. **Axiomatic Violation Audit**: Direct, verifiable breaches of structural constraints.
4. **Member Mapping Success**: Evaluation of how often ghost symbols matches physical providers.

> [!CAUTION]
> **Substrate Integrity Score < 70**: Triggers the **Architectural Alarm**. In this state, the agent is restricted to **Reactive Healing** only until forensic sovereignty is restored.

> [!NOTE]
> **V140 Industrial Protocol Active**: Incorporates Deterministic Forensics, Reactive GC, and Industrial Member Mapping.
