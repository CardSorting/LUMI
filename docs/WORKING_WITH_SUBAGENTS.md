---
title: "Working with Sub-agents"
sidebarTitle: "Sub-agents"
description: "How LUMI delegates work via use_subagents and the subagent runtime."
---

# Working with Sub-agents

LUMI can spawn **subagents** — isolated agent runs with their own prompts, tools, and optional model configuration — through the `use_subagents` tool and dynamic subagent tool names.

## Code map

| Component | Path |
|-----------|------|
| Tool entry | `use_subagents` → `SubagentToolHandler` |
| Runner | `src/core/task/tools/subagent/SubagentRunner.ts` |
| Config loader | `src/core/task/tools/subagent/AgentConfigLoader.ts` |
| Builder | `src/core/task/tools/subagent/SubagentBuilder.ts` |
| Dynamic tool names | `src/core/task/tools/subagent/SubagentToolName.ts` |
| Swarm consensus | `src/core/task/tools/subagent/SwarmConsensusHandler.ts` |
| Orchestrator metadata | `src/infrastructure/ai/Orchestrator.ts` |

`ToolExecutorCoordinator` registers static tools from `DietCodeDefaultTool` and **dynamic subagent handlers** loaded at runtime.

## How it works

1. The main `Task` calls `use_subagents` with agent type(s) and prompts.
2. `SubagentBuilder` constructs a child task with inherited or overridden API configuration (`buildApiHandler`).
3. `SubagentRunner` executes the child loop with scoped tools.
4. Results return to the parent task as tool output; shared memory tools (`mem_append_shared`, `mem_get_shared`, `mem_claim`, `mem_release`) coordinate cross-agent state.

## Agent types

Subagent configs can specify types such as `worker`, `verifier`, and `researcher` (see `Orchestrator` task traces). Each type can carry different tool allowlists and completion gates (`subagentCompletionGates.ts`).

## User-facing usage

- Enable subagents in settings when exposed in the webview.
- Ask LUMI to delegate research or verification explicitly.
- Monitor subagent messages in the chat timeline like any other tool call.

## Safety

Subagents inherit the same approval and hook pipeline as the parent task:

- **PreToolUse / PostToolUse hooks** apply per tool invocation.
- **Auto-approve** rules from `src/core/task/tools/autoApprove.ts` still gate mutating tools.
- **Completion gates** can block `attempt_completion` until subagent results pass validation.

## Related

- [Subagents feature guide](features/subagents.mdx)
- [All tools — use_subagents](tools-reference/all-dietcode-tools.mdx)
- [Memory & reasoning](MEMORY_AND_REASONING.md)
