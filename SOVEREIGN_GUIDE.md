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

### 1. Active Surveillance (SovereignContext)
Every `read_file` turn is now augmented with a `[SOVEREIGN_CONTEXT]` block. 
- **Density Awareness**: If logic density > 15% in an Infrastructure file, move the logic to DOMAIN.
- **Entropy Awareness**: If I/O entropy > 5% in a Domain file, isolate the I/O to INFRASTRUCTURE.
- **Complexity Awareness**: High complexity in PLUMBING indicates a need for modularization.

## 🤝 Swarm Consensus Protocol
When performing a mission-critical refactor (e.g., `decompose_sovereign_module`):
1. Spawn a subagent with the `Architecture_Verifier` profile.
2. Provide the decomposition blueprint.
3. If the Verifier identifies an axiom violation (e.g., logic leaks into infrastructure), adjust the plan.
4. Finalize only when consensus is reached.

## 🗺️ Visual Sovereignty
Use `generate_sovereign_map` to visualize the structural health and coupling of the substrate. High integrity is marked by low coupling between layers and high internal cohesion within Domain modules.

### 2. Axiomatic Scaffolding (Born Sovereign)
Use the `scaffold_sovereign_module` tool to create new components.
- **Command**: `scaffold_sovereign_module { name: "UserAuth", layer: "domain" }`
- **Blueprint Outcome**: The tool ensures the correct directory, file name, `[LAYER]` tag, and base template are applied instantly. Never create files manually if you can scaffold.
