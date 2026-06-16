---
title: "Forensic Knowledge Graph"
sidebarTitle: "Knowledge Graph"
description: "How LUMI uses semantic mapping and impact analysis to understand your project deeper than any other agent."
---

# Forensic Knowledge Graph

LUMI doesn't just read your files; it maps the "soul" of your project using a **Forensic Knowledge Graph**. This system allows the agent to understand not just what your code says, but how every part of it relates to the rest of the system.

## 🛰️ Semantic Impact Analysis (Blast Radius)

One of LUMI's most powerful "hidden" features is its ability to calculate a **Blast Radius** before making a change.

- **Correlation Mapping**: The agent analyzes your task history to find files that are frequently co-modified. If you change a piece of auth logic, LUMI knows that the middleware, database models, and unit tests are likely affected.
- **Recursive Dependency Walking**: It walks the knowledge graph recursively to find deep dependencies that a simple search might miss.
- **Pre-emptive Warnings**: If a proposed change has a high "Blast Radius," LUMI will flag it during the planning phase, suggesting that you review related modules before proceeding.

## 🧠 Long-Term Directive Memory (Landmarking)

To prevent the agent from getting "confused" during long-running tasks, LUMI uses a sophisticated memory management system called **Landmarking**.

- **Cognitive Snapshots**: Periodically, the agent takes a snapshot of its current understanding of the task.
- **AI-Compacted Landmarks**: When task history becomes too deep, LUMI "compacts" the history into a **Landmark**—a high-density summary of decisions, requirements, and project state.
- **Directive Preservation**: These landmarks ensure that core project directives are never lost, even in sessions with hundreds of messages.

## 🚦 Architectural Chokepoint Detection

LUMI's knowledge graph monitors the "health" of your project structure in real-time:

- **Churn Analysis**: It tracks which files are modified most frequently. High churn often indicates a "chokepoint" that needs refactoring.
- **Centrality (Hub) Scoring**: The system calculates "Hub Scores" for every file. Highly central files are recognized as critical infrastructure, and the agent treats them with extra caution.
- **Contention Monitoring**: It identifies areas of the code where multiple features or agents are competing for changes, helping you avoid merge conflicts and structural debt.

## 🗺️ Semantic Context Routing

Instead of flooding the AI with irrelevant files, LUMI uses **Context Routing** to bring in exactly what's needed:

- **Graph-Based Retrieval**: When you mention a file, LUMI also pulls in its closest "neighbors" from the knowledge graph.
- **Heuristic Focus**: It prioritizes files that have a high historical correlation with your current task, ensuring the agent always has the "Big Picture" without the noise.

---
*True intelligence is about seeing the connections. LUMI maps the connections so you can build with total context.*
