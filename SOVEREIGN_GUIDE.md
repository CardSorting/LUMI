# 🛰️ JoyZoning: The Sovereign Guide

This document serves as the high-fidelity architectural compass for AI agents operating within this codebase. Adherence to these axioms is mandatory.

## 🏗️ Layer Fingerprints
The substrate evaluates every file based on three archetypal dimensions. Use these to ensure your code is placed in the correct layer.

| Layer | Optimal Logic Density | Max I/O Entropy | Max Complexity | Soul |
| :--- | :--- | :--- | :--- | :--- |
| **DOMAIN** | > 15% | 0% | High | Pure logical truths, zero side effects. |
| **CORE** | 5% – 15% | 0% | Moderate | Orchestrating domain entities. No I/O. |
| **INFRASTRUCTURE** | < 10% | > 20% | High | Adapters to the outside world (FS, DB, API). |
| **PLUMBING** | < 5% | 0% | < 500 Nodes | Stateless, shared utility functions. |
| **UI** | N/A | High | High | Presentation logic and view states. |

## ⚖️ The Design Axioms

### 1. Axiom of Statelessness ([LAYER: PLUMBING])
Plumbing modules are pure mathematical utilities. They must NEVER declare mutable top-level state.
*   **BAD**: `let counter = 0; export const inc = () => counter++;`
*   **GOOD**: `export const add = (a, b) => a + b;`

### 2. Axiom of Dependency Inversion
Stable logic (**DOMAIN** & **CORE**) must only depend on abstract interfaces.
*   **Violation**: `import { LocalDiskStore } from "@/infra/LocalDiskStore"`
*   **Sovereign**: `import { IStore } from "@/core/interfaces/IStore"`

### 3. Axiom of Interface Segregation
If a **CORE** module depends on more than 5 infrastructure adapters, it is a "Fat Coordinator" and must be split into mission-focused services.

## 🛡️ The Sovereign Shield
This project is protected by a proactive guard. If you attempt an edit that drops global structural integrity by > 10%, the edit will be intercepted and rejected with a remediation signal. Do not fight the shield; follow the remediation.

## 💊 Autonomous Healing
If the codebase enters a "Fever" state (Integrity < 70%), run the alignment script:
```bash
npx ts-node src/scripts/align-sovereignty.ts
```

## 🛰️ Agent Intelligence Features

### 1. Active Surveillance (Spider Engine V210)
Every `read_file` turn is now augmented with a `[SOVEREIGN_CONTEXT]` block, powered by a **Metabolic Sovereign** industrial suite:
- **Zero-Inflation Sensing**: Architectural audits are performed with zero redundant collection allocations, ensuring a stationary heap footprint.
- **Forensic Realism**: Deterministically detects "ghost symbols" via physical AST sensing across the project graph.
- **Metrics Engine**: Real-time evaluation of Logic Density, I/O Entropy, and **AST Complexity Scaling**.
- **Generational GC**: Turn-based TTL autonomously purges stagnant forensic caches every 5 turns.
- **Metabolic Pulse**: Inter-batch GC turns during massive scans to ensure zero-saturation indexing.

### 2. Forensic Realism
When moving or deleting files, the Forensic Engine verifies symbol integrity project-wide. 
- **Rule**: All materialized symbols must use **Industrial Member Mapping** to ensure 100% structural fidelity with provider modules.

## 🤝 Swarm Consensus Protocol (V210)
When performing a mission-critical refactor (e.g., `decompose_sovereign_module`):
1. Spawn a subagent with the `Architecture_Verifier` profile.
2. Provide the decomposition blueprint.
3. If the Verifier identifies an axiom violation (e.g., logic leaks into infrastructure), adjust the plan.
4. Finalize only when consensus is reached.

---

## 🔋 Metabolic Sovereignty & Immortality (V210)
The substrate has achieved absolute metabolic sovereignty through zero-inflation performance and clinical residual purging.
- **Stability Lock 2.0**: Transaction concurrency is managed via session-authenticated IDs, preventing "Late Return" race conditions and structural corruption.
- **Substrate Checkpoints**: Binary serialization of the node graph (Merkle-mapped) enables instant **Structural Rollback** if an edit compromises substrate integrity.
- **Metabolic Pressure Sensing**: The substrate monitors V8 heap statistics. At **> 80% pressure**, it triggers a **Substrate Sweep**; at **> 90%**, it enforces an **Absolute Sweep** (Forceful purification).
- **Zero-Inflation Identification**: Eliminates redundant Set/Map allocations in high-velocity structural loops using nested map caching.
- **Clinical Session Purge**: Forceful nullification of `sessionBuffer` residuals immediately after turn completion.
- **Industrial Throttling**: Project-wide re-indexing is batched (250 files) with event loop relinquishing to prevent host saturation.
- **Clinical Closure Hygiene**: Explicit nullification of AST visitors and closures after every turn to ensure a zero-leak sensing environment.

## 🩹 Forensic Resilience & Recovery (V200 Industrial)
The substrate now operates on a platform of **Forensic Realism** and **Stability Locking**.
- **Deterministic Traceability**: Substrate repairs are grounded in physical structural proof. Imports and member signatures are extracted directly from the graph using AST forensics.
- **Neural Forensics (V188-V189)**: Every turn extracts the **Cognitive Focus (🧠)** symbols currently under investigation. This prevents "investigative drift" and ensures the agent remains grounded.
- **Reactive Stabilization**: Build errors trigger **Wave-Front Healing** sweeps focused strictly on repairing verified violations.

## 🛡️ The Substrate Immune System (V189-V210)
Designed to protect the most venerable parts of the codebase, the **Immune System** monitors for high-entropy violations.
- **Fragility Interdiction**: Modules with a **Change Complexity Index (CCI) > 0.8** trigger defensive alarms. Broad mutations in these clusters are restricted to prevent regression spirals.
- **Pathogen Memory**: Files with chronic failure history trigger **Deep Forensic Scans**, enforcing absolute structural purity and pruning all technical debt.
- **Forensic Pruning**: Automatically suppresses heuristic violations if the native compiler (TSC) verifies the module is clean.

## 🌊 Wave-Front Healing (Reactive)
Automated stabilization is now reactive and forensic. When a build error is detected, the Garbage Collector identifies the required repairs and schedules a recursive sweep of the dependent **Wave-Front** (2-degree depth), achieving project-wide stability in a deterministic loop.

## ✨ The Sovereign Economy (Incentives)
- **Structural Karma**: Earned by reducing project-wide entropy by > 5%. Karma pardons all strikes and resets metabolic pressure.
- **Metabolic Velocity**: Your write/read budget is now adaptive. High-Karma agents gain **1.5x velocity**; Axiomatic Drift induces **0.5x velocity braking**.
- **Substrate Vitality (💓 Pulse)**: A real-time heartbeat of the project. If Vitality drops below 40%, the substrate enters **Safe Mode**.


