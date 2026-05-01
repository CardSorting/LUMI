---
title: "Working with Sub-agents"
sidebarTitle: "Sub-agents"
description: "How DietCode delegates complex tasks to specialized background agents."
---

# Working with Sub-agents

For large or complex tasks, DietCode can create **Sub-agents**—specialized background instances of the AI that focus on a single piece of the problem. This guide explains how sub-agents work and how you can use them to scale your productivity.

## 🤝 Collaboration Patterns

When you give DietCode a massive task (e.g., "Rewrite the entire auth system"), the main agent acts as the **Orchestrator**. It then delegates work to sub-agents using these patterns:

- **Parallel Research**: Multiple sub-agents can analyze different parts of your codebase simultaneously to find relevant context.
- **Specialized Implementation**: One sub-agent might focus on database migrations while another builds the React components.
- **Review & Verification**: A sub-agent can be tasked with running tests and reviewing the work of another agent to ensure quality.

## 🛠️ How to Use Sub-agents

Sub-agents are usually managed automatically by DietCode, but you can also direct them:

1.  **Creation**: Use the `subagent` command or simply ask DietCode to "spin up a researcher."
2.  **Tasks**: Give each sub-agent a specific, narrow goal.
3.  **Handoff**: Sub-agents report their findings back to the main Orchestrator, which integrates the changes into your workspace.

## ⚖️ Safety & Control

Every sub-agent is bound by the same rules as the main agent:

- **Permission**: Sub-agents cannot make file changes or run commands without your approval (relayed through the Orchestrator).
- **Resource Limits**: You can set limits on how many sub-agents can run and how much credit they can consume.
- **Observability**: You can watch the "thoughts" and logs of every sub-agent in the DietCode panel.

---
*Scale your intelligence, not your effort. Use sub-agents to handle the heavy lifting.*
