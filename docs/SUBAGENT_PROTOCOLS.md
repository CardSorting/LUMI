# Subagent Swarm Protocols

DietCode V210 implements a sophisticated **Multi-Agent System (MAS)** that coordinates specialized subagents through a series of deterministic industrial protocols. These protocols ensure that even a massive swarm remains grounded in architectural truth.

## 🧬 Swarm Identity

Every subagent is initialized via the `SubagentBuilder` (`src/core/task/tools/subagent/SubagentBuilder.ts`), which injects a specialized **Swarm Profile** containing its identity, allowed tools, and mandated protocols.

---

## 🛰️ Industrial Protocols

### 1. Swarm Consensus Protocol
Critical modifications require autonomous verification. Subagents implement a peer-review loop before finalizing tasks.
- **Protocol**:
    1.  Invoke `use_subagents` with the `Verifier` profile.
    2.  Provide the `Verifier` with the proposed diff and the original objective.
    3.  Finalize only after the `Verifier` signals: `SIGNAL: CONSENSUS_REACHED`.

### 2. Autonomous Nudge Protocol
To prevent reasoning spirals, subagents are programmed to detect **Context Uncertainty**.
- **Trigger**: Ambiguous requirements or failure to ground symbols in the [Cognitive Memory (BroccoliDB)](COGNITIVE_PRIMITIVES).
- **Action**: Invoke `mem_refresh` or explicitly request a **Grounded Specification Refresh** from the parent agent.

### 3. Structured Signaling Protocol
Communication between swarm members uses high-visibility industrial markers for categorical reporting.
- **Markers**: 
    - `[SIGNAL: ARCHITECTURE_VIOLATION]`: For reporting design axiom drifts.
    - `[SIGNAL: SECURITY_RISK]`: For flagging unsafe command patterns or credential leaks.
    - `[SIGNAL: GROUNDING_LOSS]`: For reporting failure to align with the forensic substrate.

---

## 📈 JoyZoning Alignment Reporting

In accordance with the [JoyZoning 3.0](JOYZONING_SOVEREIGNTY_3_0) model, every subagent must provide a **JoyZoning Alignment** section in its final report (`attempt_completion`):

1.  **Layer Categorization**: Every explored file must be categorized by its physical layer (Domain, Core, Infrastructure, UI, or Plumbing).
2.  **Architectural Suitability**: Evaluation of whether the logic appears in the correct zone.
3.  **Outside-In Dependency Check**: Verification that implementation respects the `Infrastructure -> Core -> Domain` flow.

## 🛠️ Subagent Tooling

| Handler | Code Path | Description |
| :--- | :--- | :--- |
| **SubagentBuilder** | `subagent/SubagentBuilder.ts` | Injects protocols and system prompts into swarm members. |
| **AgentConfigLoader** | `subagent/AgentConfigLoader.ts` | Loads specialized profiles (Verifier, Architect, Refactorer). |
| **SubagentRunner** | `subagent/SubagentRunner.ts` | Orchestrates the session isolation and result parsing. |

---

> [!IMPORTANT]
> **Swarm Hygiene**: Subagents operate with a **Capped Thinking Budget** (8k tokens by default) to ensure they remain focused on forensic research rather than abstract speculation.
