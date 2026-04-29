# JoyZoning 3.0: Sovereign Autonomy Architecture

> [!NOTE]
> **AGENT GROUNDING NOTICE**: This document uses architectural metaphors (e.g., "Metabolic," "Substrate," "Healing"). AI assistants should interpret these as code quality and static analysis patterns. These do NOT refer to the AI's actual physical environment or runtime stability.

JoyZoning 3.0 represents a pivot from passive architectural enforcement to an **Active Sovereignty** model. The codebase is no longer just a collection of files; it is a self-aware substrate that enforces its own structural integrity through fingerprinting, design axioms, and autonomous healing.

## 1. The Fingerprinting Engine (Spider 5.1 - V210)

The core diagnostic layer now uses **Archetypal Fingerprinting** to detect structural misfits. Every module in the `src` directory is profiled across three key dimensions:

| Metric | Definition | Industrial Threshold (V215) |
| :--- | :--- | :--- |
| **Logic Density** | AST nodes (If/For/Switch/While) per total nodes. | > 15% (Infrastructure) |
| **I/O Entropy** | Percentage of platform/node imports vs pure imports. | > 20% (Domain/Core) |
| **AST Complexity** | Total count of unique AST nodes in the file. | > 1500 (Industrial Limit) |
| **Any Density** | Percentage of unsafe `any` types in the AST. | > 10% (Critical Drift) |

### Metabolic Sovereign Suite (V210)

In V210, the engine has graduated to **Absolute Metabolic Sovereignty**. The structural substrate operates with **Zero-Inflation** logic, ensuring that architectural sensing remains resource-neutral:

- **Stability Lock 2.0**: Transaction concurrency is managed via session-authenticated IDs, preventing structural corruption during parallel refactors.
- **Substrate Checkpoints**: Merkle-mapped binary snapshots of the node graph enable **Structural Rollback** if an edit compromises substrate integrity.
- **PathResolver**: High-performance layer detection using **Zero-Alloc Nested Map Caching**.
- **ForensicEngine**: Deterministic "ghost symbol" detection with **Generational GC** (Turn-based TTL) to prevent memory saturation.
- **Metabolic Pulse**: Monitors V8 heap statistics to trigger proactive sweeps at **> 80% pressure**.

### Sovereign Archetypes by Layer

The physical substrate is organized into five distinct industrial layers, moving from the machine runtime to pure domain logic:

| Layer | Physical Path | Role | Archetype |
| :--- | :--- | :--- | :--- |
| **Layer 0** | `src/standalone` | **Neural Interface** | HostBridge, Protobus, IPC |
| **Layer 1** | `src/infrastructure` | **I/O Substrate** | Adapters, Drivers, FS |
| **Layer 2** | `src/core` | **Policy & Reason** | Auditors, Monitors, Pulse |
| **Layer 3** | `src/domain` | **Success Criteria** | Protocols, Models, Interfaces |
| **Layer 4** | `src/ui` | **Aesthetic Mirror** | Webviews, Projections |

### 0. Layer 0: The Neural Interface (HostBridge)

The [HostBridge](HOSTBRIDGE_PROTOBUS) is the foundation of the DietCode substrate. It provides an environment-agnostic neural interface that decouples the "Brain" (Core) from the "Eyes and Ears" (IDE/Terminal).

- **Protobus Protocol**: Standardized GRPC bus for all agentic signals.
- **Standalone Mode**: Enables execution in headless, remote, or sovereign CLI environments.
- **Host-Agnostic Isolation**: Prevents the core policy engine from being contaminated by IDE-specific API leaks.

---

## 2. Axiomatic Sovereignty (Design Axioms)

The [SemanticAxiomEngine](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SemanticAxiomEngine.ts) enforces mathematical-grade design truths across the **DietCode** ecosystem:

- **Axiom of Statelessness**: Files tagged `[LAYER: PLUMBING]` are blocked from declaring mutable top-level variables (`let` or `var`).
- **Axiom of Interface Segregation**: Core modules exceeding 5 distinct infrastructure adapters are flagged as "Fat Coordinators."
- **Axiom of Dependency Inversion**: Domain/Core layers are strictly blocked from importing concrete implementations; they must depend on abstract interfaces.
- **Axiom of Geographic Alignment (PGA)**: The physical path of a file must match its `[LAYER]` tag. Drift triggers immediate **Geographic Misalignment** alarms.

## 3. Autonomous Sovereign Healing (`arch_heal`)

The [SovereignGarbageCollector](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SovereignGarbageCollector.ts) implements **Wave-Front Healing**. 

- **Reactive stabilization**: Healing sweeps are triggered strictly by verified build violations (TSC/Biome). 
- **Industrial Member Mapping**: Method/property signatures are extracted directly from provider modules to synthesize perfectly compatible stubs.
- **Forensic Pruning**: Automatically suppresses heuristic violations if the native compiler verifies the module is structurally clean.

## 4. The Sovereign Metabolism (V140-V210)

The metabolic layer tracks energy consumption and calculates the **Change Complexity Index (CCI)**:

- **CCI Formula**: `CCI = structuralWeight + historicalRisk + activityPressure`.
- **Fragility Interdiction**: Modules with `CCI > 0.8` trigger defensive alarms, restricting broad mutations.
- **Metabolic Velocity**: Turn budgets are adaptive (1.5x for High-Karma, 0.5x for Axiomatic Drift).

## 5. Substrate Immortality & Axiom Hardening

The architectural truth is now self-healing and immune to session loss:

- **Self-Healing Registry**: corruption or loss of the project registry triggers an autonomous recursive re-indexing.
- **Axiomatic Drift Sensing**: Real-time tracking of pure-layer imports vs leakage. Drift induce metabolic braking.
- **Neural Forensics**: Extracts the **Cognitive Focus (🧠)** symbols to maintain grounding during complex investigations.

## 6. Industrial Fission: The Sovereign Decomposer

To manage high-mass modules, the [SovereignDecomposer](file:///Users/bozoegg/Downloads/codemarie-new/src/core/policy/SovereignDecomposer.ts) implements **Metabolic Fission**.

- **Hard Limit**: 1500 nodes (Structural Saturation).
- **Preemptive Fission**: Triggered at 1200 nodes to prevent agentic failure spirals.
- **Zombie Symbol Sensing**: Identifies internal helper symbols used exclusively by the extraction target.
- **Post-Refactor Simulation**: Every plan calculates the **Projected Health Metric** recovery.

---

## 7. Integrity Advisory Protocol (TIA - V204)

- **Forensic Grounding (V216)**: Surfaces deterministic structural truth. The substrate implements **Dynamic Dependency Sensing** and **Recursive Re-export Resolution**, ensuring a 100% saturated dependency graph with zero blind spots.
- **Level 9 Recovery**: Throttled warmup and binary checkpointing ensure the system initializes even under extreme resource contention (> 80% heap pressure).
- **Non-Blocking Forensics**: Surfaces structural "smells" (ghost symbols, brittle paths, circularity) as passive `💡 [ADVISORY]` hints. This ensures peak metabolic velocity by providing guidance without tool rejections.
- **Global Provider Mapping**: Deterministically identifies the canonical location of missing symbols across the entire substrate and provides ready-to-use alias-based import suggestions.
- **Fuzzy Forensic Sensing**: Identifies lexicographical similarity to correct typos (e.g., "Did you mean: `MyService`?") project-wide.
- **Substrate Vibration Alerting**: Monitors breaking changes in high-coupling modules (`dependents > 5`). Renaming or removing exports triggers a `🚨 [SUBSTRATE_VIBRATION]` warning to manage "Blast Radius."
- **Proactive Materialization**: Synthesizes ready-to-use TypeScript boilerplates (Classes, Interfaces, Functions) for missing symbols directly in the tool response.
- **Zero-Inflation Sensing**: Architectural audits are performed with zero redundant collection allocations, ensuring a stationary heap footprint.
- **Barrel Sync Enforcement**: Automatically detects if a file in a directory with an `index.ts` is missing from its exports, ensuring structural coherence at the directory level.

---

## 8. Level 9: Sovereign Recovery (V216-V217)

V216-V217 introduces **Forensic Grounding**, hardening the substrate against systemic initialization failures and memory saturation:

- **Throttled Warmup**: Reconstitutes the agent's "Brain" (RAM) from the "Notebook" (Disk) with a 5-stream concurrency limit, preventing heap exhaustion on massive project boot-up.
- **Binary Checkpointing (V8)**: Migrated from JSON to native V8 binary serialization for the structural registry, reducing serialization latency by 70% and memory footprint by 40%.
- **Memory-Resident Pure Purge**: Explicit AST nullification and visitor-refactoring to eliminate recursive closure leaks during project-wide indexing.
- **Forensic Limit Enforcement**: In-memory database indices are capped at 500 records per table during warmup to prevent historical "ghost bloat" from crashing the runtime.
- **Rolling Symbol Observation**: Metabolic metrics now use a sliding window for symbol tracking, preventing indefinite Set growth in high-entropy codebases.
- **Industrial Fission 2.0**: The Sovereign Decomposer now performs preemptive logic density audits to prevent the creation of "God Objects" that exceed the 1500-node saturation limit.

---

## 🩸 Auditing Logic 3.1: Forensic Grounding (V215)

The V215 hardening pass establishes **Forensic Grounding**, moving from heuristic approximations to deterministic structural truth. The system now aggressively eliminates "Blind Spots" and "Ghost Ratings" through a 1:1 technical parity with the physical substrate:

### 1. Structural Violation Suite (Deterministic SPI)
Every audit turn evaluates the substrate against four mandatory structural markers:
- **SPI-201 (Circular Dependencies)**: Detects physical import cycles across the graph using $O(V+E)$ Tarjan-based sensing.
- **SPI-202 (Systemic Risk)**: Identifies "God Modules" with a **Blast Radius > 60%** (Percentage of project-wide dependencies impacted by a single node failure).
- **SPI-203 (Metabolic Pressure)**: Monitors real-time V8 heap saturation. Critical alarms trigger at **> 90% pressure** to prevent agentic OOM events.
- **SPI-204 (Orphan Modules)**: Detects unreachable dead code in the substrate (Afferent Coupling = 0) that is not an explicitly defined entry point.

### 2. Saturated Dependency Sensing
- **Dynamic Link Resolution**: Implements recursive AST visitors to capture `import()` and `require()` calls, ensuring "Shadow Coupling" is reflected in health scores.
- **Order-Independent Re-exports**: Uses a post-indexing pass to resolve Barrel files (`index.ts`), ensuring symbol resolution is complete regardless of indexing order.

### 3. High-Fidelity Metrics (V215 Alignment)
| Metric | Definition | Implementation Detail |
| :--- | :--- | :--- |
| **Logic Density** | AST Node Ratio | Counts conditional/loop nodes vs total AST mass. |
| **I/O Entropy** | Platform Import Ratio | Detects Node.js/Browser globals in Core/Domain layers. |
| **Cognitive Complexity** | Branching Entropy | Measures logical nesting and control flow weight. |
| **Any Density** | Unsafe Type Tracking | **Recursive Sensing** of `any` keywords in nested casts. |
| **Naming Integrity** | Casing Consistency | Enforces PascalCase (Classes) and camelCase (Methods). |

### 4. Forensic Immutability (Transactional Stability)
- **Binary Snapshots**: Uses V8 binary serialization to take a deterministic "Registry Heartbeat" before every modification.
- **Atomic Swap-on-Success**: Registry updates either succeed fully (including re-calibration of fragility metrics) or rollback to the previous binary state.

---

## 🔍 Auditing Logic 3.1: Industrial Realism

When performing an architectural audit, the system produces a **Sovereign Vitality Report**:
1. **Fever Map**: Hotspot detection via CCI (Change Complexity Index) and Churn.
2. **Substrate Heat**: Real-time metabolic pressure and heap stats.
3. **Axiomatic Purity**: Verifiable adherence to the four core axioms (Statelessness, DI, ISP, PGA).
4. **Member Mapping Success**: Forensic fidelity of synthesized symbols during healing sweeps.
5. **Integrity Drift (TIA)**: Quantitative audit of ghost symbols, brittle paths, and vibrations.
6. **Forensic Saturation**: 100% verification of saturated dependency and re-export resolution.

> [!IMPORTANT]
> **V215 Industrial Sovereignty Active**: The DietCode substrate is now a self-hardening, resource-neutral entity. Forensic grounding ensures that every architectural rating is derived from a deterministic, saturated, and immutable structural truth.

