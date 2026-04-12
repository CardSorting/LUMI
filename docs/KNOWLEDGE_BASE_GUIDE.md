# Knowledge Base Guide

Welcome to the CodeMarie Knowledge Base. This guide serves as a central map for navigating our sprawling documentation, organized by your specific needs.

## 🗺️ Documentation Domains

### 1. 🚀 Getting Started (User Domain)
If you are new to CodeMarie, start here to understand the core workflow.
- [What is CodeMarie?](getting-started/what-is-cline)
- [Quick Start Guide](getting-started/quick-start)
- [Your First Project](getting-started/your-first-project)

### 2. 🧬 Cognitive Architecture (Architect Domain)
Deep dives into the internal mechanics of CodeMarie's intelligence.
- [**Memory Bank (BroccoliDB)**](features/memory-bank): The persistent knowledge graph that powers long-term reasoning.
- [**Grounding & MAS Deprecation**](hyper-cognition/GROUNDING_MAS_DEPRECATION): Post-mortem analysis and removal rationale for legacy orchestration layers.
- [**Production Optimization Summary**](PRODUCTION_OPTIMIZATION_SUMMARY): Benchmark results and engineering details for the v3.84.0 hardening initiative.
- [**Hyper-Cognition Vision**](hyper-cognition/VISION): The long-term roadmap for architectural intelligence.

### 3. 🛠️ Development & Engineering (Developer Domain)
Technical references for extending or debugging the system.
- [**Tools Reference**](tools-reference/all-cline-tools): API documentation for all built-in agentic tools.
- [**MCP Protocol**](mcp/mcp-overview): How to build and connect custom tool servers.

## 🔍 Navigation Tips
- **Searching**: Use `Cmd+K` (or the search bar) to find specific implementation details across the entire `docs/` folder.
- **Hierarchical Reading**: For a deep understanding, read **Memory Bank (BroccoliDB)** followed by **Tools Reference**.
- **Shared Reasoning**: Look for the `ANNOTATES` edges in BroccoliDB to trace the reasoning history of any task.

## 📋 Release Notes
Stay updated with the latest architectural hardening passes in the [Changelog](../CHANGELOG.md) and [Production Hardening Log](../CHANGELOG_V2.md).
