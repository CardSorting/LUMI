# Documentation Guide

Welcome to the DietCode documentation guide. This page provides a high-level map of our guides, tutorials, and technical references, organized to help you find exactly what you need.

## 🏛️ The DietCode Philosophy

Unlike traditional AI assistants that rely on metaphors, DietCode documentation is **Forensic and Literal**. We prioritize:
- **1-to-1 Code Parity**: Every architectural guide mirrors the physical structure of the `src/` directory.
- **Architectural Sovereignty**: We focus on how the agent respects your project's layering and standards.
- **Human-in-the-Loop**: We emphasize your control over every tool execution and file modification.

---

## 🧭 Documentation Map

### 1. 🚀 Getting Started
New to DietCode? Start here to get up and running quickly.
- [**The DietCode Edge**](THE_DIETCODE_EDGE.md): Our competitive wedge in agentic pair programming.
- [**What is DietCode?**](getting-started/what-is-dietcode.mdx): Core features and workspace integration.
- [**Quick Start Guide**](getting-started/quick-start.mdx): Install and configure in under 2 minutes.
- [**Your First Project**](getting-started/your-first-project.mdx): A step-by-step tutorial building a real app.
- [**Glossary**](getting-started/glossary.mdx): Definitions for key terms used in the docs.

### 2. 📖 User Guide
Everything you need to know for your daily development with DietCode.
- [**Task Management**](core-workflows/task-management.mdx): Starting, resuming, and organizing tasks.
- [**Plan & Act**](core-workflows/plan-and-act.mdx): The core AI reasoning workflow.
- [**Working with Files**](core-workflows/working-with-files.mdx): Navigation, editing, and context @-mentions.
- [**Checkpoints**](core-workflows/checkpoints.mdx): Saving and restoring your project state.

### 3. ⚡ Advanced Features
Unlock more power with specialized agent behaviors and integrations.
- [**Sub-agents**](WORKING_WITH_SUBAGENTS.md): Delegating complex work to background agents.
- [**Model Context Protocol (MCP)**](mcp/mcp-overview.mdx): Extending DietCode with custom tools and APIs.
- [**Custom Interceptors (Hooks)**](CUSTOM_INTERCEPTORS.md): Write your own lifecycle interceptors.
- [**Rules & Customization**](customization/overview.mdx): Personalize the agent's behavior for your project.

### 4. 🎨 Interface & Experience (MIRA)
The sidebar presents as **MIRA** — comfort-first developer tooling designed to reduce tension during long sessions.
- [**User Interface Design**](USER_INTERFACE_DESIGN.md): MIRA emotional UX strategy, voice system, audit-as-notebook, and contributor guidelines.
- [**MIRA UX Implementation**](MIRA_UX_IMPLEMENTATION.md): Engineer-facing file map, APIs (`miraVoice`, session comfort, audit tokens), and wiring checklist.

### 5. 📐 Architecture & Security
Deep dives into how DietCode works and how it keeps your code safe.
- [**Architectural Enforcement**](ARCHITECTURAL_ENFORCEMENT.md): The Forensic Architect engine.
- [**Knowledge Graph Forensics**](KNOWLEDGE_GRAPH_FORENSICS.md): Semantic mapping and Blast Radius analysis.
- [**Project Map**](PROJECT_MAP.md): A literal guide to the `src/` directory and internal modules.
- [**Security & Best Practices**](SECURITY_BEST_PRACTICES.md): Data privacy, human-in-the-loop, and safe automation.
- [**Codebase Standards**](CODEBASE_STANDARDS.md): Layering rules and AI-friendly coding patterns.
- [**Stability Report**](STABILITY_REPORT.md): Monitoring technical debt and system health.
- [**System Communication**](SYSTEM_COMMUNICATION.md): IPC, Protobuf, and host synchronization details.

---

## 🔍 Searching the Docs
- Use `Cmd+K` anywhere in the documentation to launch a global search.
- If you're looking for a specific folder's role, refer to the [Project Map](PROJECT_MAP.md).
- For security-related questions, see [Security & Best Practices](SECURITY_BEST_PRACTICES.md).

---
*Built for developers, by developers. Let's build something amazing.*
