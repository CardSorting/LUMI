# 🦠 Pathogen Registry (Forensic Hotspots)

The Pathogen Registry identifies modules with chronic structural instability, high mass, or layer boundary leakage. These components are prioritized for **Industrial Fission** or **Forensic Healing**.

## 🔴 CRITICAL PATHOGENS

### `src/core/policy/FluidPolicyEngine.ts`
- **Pathology**: **Structural Saturation & Layer Leakage**.
- **Metrics**: 1787 nodes (Limit: 1500), 29 Churn Count, CCI: 0.98.
- **Axiomatic Breach**: Imports `infrastructure/ai/Orchestrator`, violating the Core -> Domain -> Infrastructure boundary.
- **Remediation Plan**: Perform **Industrial Fission** using `SovereignDecomposer`. Extract `EnvironmentSovereignty` and `AxiomVerification` into standalone services.
- **Status**: ALARMED (Metabolic Braking Active).

---

## 🟠 HIGH-FRAGILITY CLUSTERS

### `src/core/task/tools/RefactorHealer.ts`
- **Pathology**: **Heuristic Volatility**.
- **Metrics**: 17 Churn Count, CCI: 0.78.
- **Diagnostics**: High frequency of "Ghost Symbol" materialization failures due to fragile AST traversal logic.
- **Remediation Plan**: Harden the `ForensicMemberExtraction` logic to use the centralized `SpiderEngine` registry instead of local file reads.

### `src/core/policy/SemanticAxiomEngine.ts`
- **Pathology**: **Axiomatic Drift**.
- **Metrics**: 17 Churn Count.
- **Diagnostics**: Frequent logic changes to enforcement rules indicate unstable architectural definitions.
- **Remediation Plan**: Formalize axioms into a JSON schema to separate enforcement logic from axiomatic definitions.

---

## 🟡 STAGNANT SUBSTRATE (V142)
Modules with zero activity for > 15 days, potentially redundant or decoupled from the active mission.

| File | Last Activity | Afferent Coupling | Status |
| :--- | :--- | :--- | :--- |
| `src/core/policy/SimulationEngine.ts` | 14 days ago | 1 | Stagnant |
| `src/core/policy/TspPolicyPlugin.ts` | 12 days ago | 2 | Stable |

---

## 📊 Immunity Summary
- **Substrate Health**: 68/100 (Below Alarm Threshold).
- **Active Alarms**: 1 (Monolithic Saturation in `FluidPolicyEngine`).
- **Healing Success Rate**: 92% (Industrial Member Mapping effectiveness).

> [!CAUTION]
> **Industrial Warning**: Pathogens increase the probability of **Agentic Failure Spirals**. Refactoring these hotspots is a pre-requisite for high-velocity Domain development.
