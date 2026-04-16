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

### 1. Active Surveillance (Spider Engine V140)
Every `read_file` turn is now augmented with a `[SOVEREIGN_CONTEXT]` block, powered by a modular diagnostic suite:
- **Forensic Realism**: Deterministically detects "ghost symbols" via physical AST sensing across the project graph.
- **Metrics Engine**: Real-time evaluation of Logic Density, I/O Entropy, and **AST Complexity Scaling**.
- **Persistence Manager**: Ensures architectural state is atomically persisted in `.spiderbin`.

### 2. Forensic Realism
When moving or deleting files, the Forensic Engine verifies symbol integrity project-wide. 
- **Rule**: All materialized symbols must use **Industrial Member Mapping** to ensure 100% structural fidelity with provider modules.

## 🤝 Swarm Consensus Protocol
When performing a mission-critical refactor (e.g., `decompose_sovereign_module`):
1. Spawn a subagent with the `Architecture_Verifier` profile.
2. Provide the decomposition blueprint.
3. If the Verifier identifies an axiom violation (e.g., logic leaks into infrastructure), adjust the plan.
4. Finalize only when consensus is reached.

## 🗺️ Visual Sovereignty
Use `generate_sovereign_map` to visualize the structural health and coupling of the substrate. High integrity is marked by low coupling between layers and high internal cohesion within Domain modules.

- **Blueprint Outcome**: The tool ensures the correct directory, file name, `[LAYER]` tag, and base template are applied instantly. Never create files manually if you can scaffold.

## 🔋 Metabolic Resilience (V100/V110)
To support high-velocity development, the substrate optimizes for "flow state" by damping pressure during intensive refactoring.
- **Cognitive Resonance**: During `#REFACTOR` or `#HEAL` turns, metabolic pressure is damped at **0.5x velocity**.
- **Metabolic Synthesis**: Atomic writes to the same file in a single turn are discounted by **50%**, rewarding iterative refinement.
- **Aesthetic Agility**: Changes to whitespace, line breaks, or comments (Aesthetic Hash) have a **90% discount** and never trigger blockades.

## 🩹 Forensic Resilience & Recovery (V140 Industrial)
The substrate now operates on a platform of **Forensic Realism**.
- **Deterministic Traceability**: Substrate repairs are grounded in physical structural proof. Imports and member signatures are extracted directly from the graph using AST forensics.
- **Reactive Stabilization**: Build errors trigger asynchronous sweeps by the Garbage Collector. These sweeps focus strictly on repairing verified violations, ensuring that development flow is never blocked by hypothetical substrate predictions.
- **Forensic repairLog**: Use the repairLog in the Garbage Collector to trace any autonomous structural heals applied during your session.

## 🌊 Wave-Front Healing (Reactive)
Automated stabilization is now reactive and forensic. When a build error is detected, the Garbage Collector identifies the required repairs and schedules a recursive sweep of the dependent wave-front, achieving project-wide stability in a deterministic loop.

## ✨ The Sovereign Economy (Incentives)
- **Structural Karma**: Earned by reducing project-wide entropy by > 5%. Karma pardons all strikes and resets metabolic pressure.
- **Metabolic Velocity**: Your write/read budget is now adaptive. High-Karma agents gain **1.5x velocity**; introduction of Axiomatic Drift induces **0.5x velocity braking**.
- **Immune Memory**: Failure patterns are tracked. Files with chronic issues (Pathogens) trigger **Deep Forensic Scans** that are more restrictive during cleanup.
