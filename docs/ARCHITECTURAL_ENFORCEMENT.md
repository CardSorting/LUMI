---
title: "Architectural Enforcement Engine"
sidebarTitle: "Architectural Enforcement"
description: "The deep forensic systems that ensure code quality, layer purity, and system stability."
---

# Architectural Enforcement Engine

DietCode is unique because it includes a built-in **Architectural Enforcement Engine**. This isn't just a linter; it's a real-time policy layer that monitors every thought and action the agent takes to ensure your codebase remains clean, modular, and stable.

## 🛡️ The Universal Guard

At the heart of DietCode is the **Universal Guard**. This system acts as a forensic monitor that sits between the AI's reasoning and your physical workspace.

- **Layer Awareness**: DietCode understands the specific role of every file in your project (e.g., `DOMAIN`, `CORE`, `INFRASTRUCTURE`).
- **Contextual Blocking**: In **Plan Mode**, the guard actively prevents the agent from making side effects in sensitive layers like `CORE` or `DOMAIN`, ensuring that the planning phase remains pure and focused on architecture.
- **Architectural Guidance**: If the agent proposes a change that violates project layering rules (e.g., a Domain model importing from an Infrastructure adapter), the Guard intercepts the action and provides immediate "Architectural Feedback."

## 🩺 Autonomous Self-Healing

DietCode doesn't just write code; it maintains it. The **Refactor Healer** system runs automatically after file edits to ensure consistency:

- **Tag Alignment**: Automatically synchronizes JSDoc tags, file headers, and metadata to match project standards.
- **Import Resolution**: Ensures that new code uses the correct project-wide aliases and follows module boundary rules.
- **Structural Cleanup**: If an edit introduces minor structural inconsistencies, the healer attempts to resolve them before presenting the final result for your approval.

## 📡 Reactive Policy Observation

DietCode monitors the AI's "thought stream" in real-time, even before a tool is executed:

- **Smell Detection**: The **Policy Observer** scans streaming output for "architectural smells"—patterns that indicate the agent might be heading toward a poor design choice.
- **Real-time Warnings**: It can surface warnings to both you and the AI agent during the thinking phase, allowing for immediate course correction before code is even written.

## 📊 Stability Telemetry

Every change is measured for its impact on project health:

- **Stability Scores**: After a successful edit, DietCode calculates a stability score for the affected file based on complexity, churn, and dependency health.
- **Violation Tracking**: The system tracks how many architectural violations were introduced or resolved during a task, providing a clear "Net Health" impact report.

---
*DietCode isn't just an agent that codes; it's an architect that enforces. Build systems that stand the test of time.*
