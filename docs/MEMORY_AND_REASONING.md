---
title: "AI Memory & Reasoning"
sidebarTitle: "Memory & Reasoning"
description: "How DietCode processes information, remembers context, and solves complex problems."
---

# AI Memory & Reasoning

DietCode is more than just a code generator; it's a reasoning engine that understands your project's history and intent. This guide explains how the agent processes information and maintains context over long tasks.

## 🧠 The Reasoning Engine

DietCode follows a deterministic **Observe → Plan → Act** cycle to ensure that every decision is grounded in the current state of your code.

- **Observation**: The agent reads files, checks terminal logs, and analyzes your workspace to gather facts.
- **Planning**: It breaks down your request into a sequence of logical steps, considering edge cases and dependencies.
- **Execution**: It uses its toolbelt (Shell, Browser, File Editor) to implement the plan, one step at a time.

## 💾 Local Memory (BroccoliDB)

To stay smart over time, DietCode uses a local **Context Store** (powered by SQLite) to remember:

- **Task History**: Every conversation and decision made during a session is recorded.
- **Project Knowledge**: Lessons learned about your project's specific architecture and patterns.
- **Checkpoints**: Periodic snapshots of your files that allow you to "undo" any task instantly.

## 🔍 Context Management

Processing a large project requires focus. DietCode uses several techniques to manage context:

- **Relevance Ranking**: It prioritizes files that are most likely to be affected by your current request.
- **Dynamic Pruning**: It removes old or irrelevant information from its "short-term memory" to keep model performance high.
- **Symbol Mapping**: It uses static analysis to track how functions and variables are used across your entire project.

---
*Context is the differentiator between a code snippet and a software solution. DietCode keeps you focused on the big picture.*
