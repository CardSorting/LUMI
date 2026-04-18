# JoyZoning 3.0: Sovereign Autonomy Architecture

JoyZoning 3.0 represents a pivot from passive architectural enforcement to an **Active Sovereignty** model. The codebase is no longer just a collection of files; it is a self-aware substrate that enforces its own structural integrity through fingerprinting, design axioms, and autonomous healing.

## 1. The Fingerprinting Engine (Spider 5.1 - V210)

The core diagnostic layer now uses **Archetypal Fingerprinting** to detect structural misfits. Every module in the `src` directory is profiled across three key dimensions:

| Metric | Definition | Industrial Threshold (V210) |
| :--- | :--- | :--- |
| **Logic Density** | AST nodes (If/For/Switch/While) per total nodes. | > 15% (Infrastructure) |
| **I/O Entropy** | Percentage of platform/node imports vs pure imports. | > 20% (Domain/Core) |
| **AST Complexity** | Total count of unique AST nodes in the file. | > 1500 (Industrial Limit) |

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

## 🔍 Auditing Logic 3.1: Industrial Realism

When performing an architectural audit, the system produces a **Sovereign Vitality Report**:
1. **Fever Map**: Hotspot detection via CCI and Churn.
2. **Substrate Heat**: Real-time metabolic pressure and heap stats.
3. **Axiomatic Purity**: Verifiable adherence to the four core axioms.
4. **Member Mapping Success**: Forensic fidelity of synthesized symbols.

> [!IMPORTANT]
> **V210 Industrial Sovereignty Active**: The DietCode substrate is now a self-hardening, resource-neutral entity capable of autonomous forensic repair and cognitive grounding.
