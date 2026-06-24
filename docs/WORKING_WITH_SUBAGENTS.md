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
| Governed coordinator | `src/core/task/tools/subagent/GovernedSwarmCoordinator.ts` |
| Integration bridges | `src/core/task/tools/subagent/GovernedIntegration.ts` |
| Lock necessity | `src/core/task/tools/subagent/LockNecessity.ts` |
| Merge gate | `src/core/task/tools/subagent/MergeGate.ts` |

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

## Governed swarms

Multi-lane swarms run through `GovernedSwarmCoordinator` with durable receipts and a merge gate (optimistic reconciliation before commit). Each lane declares an **execution mode** that controls whether it acquires a governed mutation lock:

| Mode | Lock by default |
|------|-----------------|
| `read_only`, `audit_only`, `planning_only`, `documentation_only`, `diagnostic_only` | Skipped |
| `mutation` (default when omitted) | Required |

### Lifecycle (production handler)

```
roadmap pressure admit → orchestration lease → audit preflight
  → classify lane intent → acquire agent roadmap projections → DAG schedule → execute lanes
  → local events + patch proposals → per-lane completion_gate → merge gate
  → patch reconciliation → coordinator workspace commit → seal or crash seal
  → optional roadmap completion (policy-gated)
```

| Prompt / param tag | Purpose |
|--------------------|---------|
| `[execution_mode:read_only]` | Skip mutation lock |
| `[depends_on:0]` / `depends_on_2` | Lane waits until dependency sealed |
| `[roadmap_item:NOW-42]` | Link lane to roadmap item + projection |
| `[local_roadmap:progress_note:ITEM:…]` | Private agent-roadmap event (no workspace write) |
| `[propose_patch:attach_evidence:ITEM:evidence=…\|rationale=…]` | Propose workspace kanban change |
| `roadmap_completion_update=enabled` | Legacy completion policy on sealed success |

**Roadmap invariant:** Agents own private `agentRoadmap` projections. Only the coordinator commits workspace roadmap changes via reconciled `proposedWorkspacePatch` under `roadmap:workspace` lock. Do not mutate workspace kanban directly from lanes.

**Boundaries:** `MergeGate` is the commit barrier, not the workspace audit system. Audit evidence lives on governed receipts under `subagent_executions/` — BroccoliDB provides fencing/replay substrate only.

| Component | Path |
|-----------|------|
| Integration bridges | `src/core/task/tools/subagent/GovernedIntegration.ts` |
| Projection + patches | `src/core/task/tools/subagent/AgentRoadmapProjection.ts` |
| Patch reconciliation | `src/core/task/tools/subagent/RoadmapPatchReconciler.ts` |
| Coordinator commit | `src/core/task/tools/subagent/RoadmapWorkspaceCommit.ts` |
| Handler wiring | `src/core/task/tools/handlers/SubagentToolHandler.ts` |

| Doc | Contents |
|-----|----------|
| [Governed subagent execution](governed-subagent-execution.md) | Architecture, industry patterns, lifecycle |
| [Governed execution runbook](governed-execution-runbook.md) | Operator playbook, violation catalog, retry flow |
| [Governed execution schema](governed-execution-schema.md) | Receipt schema v3 reference |
| [Governed execution decisions](governed-execution-decisions.md) | ADR-style design decisions |

## Related

- [Governed subagent execution](governed-subagent-execution.md)
- [Governed execution runbook](governed-execution-runbook.md)
- [Governed execution schema](governed-execution-schema.md)
- [Subagents feature guide](features/subagents.mdx)
- [All tools — use_subagents](tools-reference/all-dietcode-tools.mdx)
- [Memory & reasoning](MEMORY_AND_REASONING.md)
