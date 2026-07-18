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
| Parent flow control | `src/core/task/tools/subagent/ParentAgentFlowControl.ts` · [Execution authority](parent-thread-execution-authority.md) |
| Deadlock analysis | `src/core/task/tools/subagent/TarjanDeadlockDetector.ts` |
| Durable lock authority | `src/core/governance/LockAuthority.ts` · `src/core/swarm/SwarmMutexService.ts` |
| Lane completion gates | `src/core/task/tools/subagentCompletionGates.ts` |
| Merge gate | `src/core/task/tools/subagent/MergeGate.ts` |

`ToolExecutorCoordinator` registers static tools from `DietCodeDefaultTool` and **dynamic subagent handlers** loaded at runtime.

## How it works

1. The main `Task` calls `use_subagents` with agent type(s) and prompts.
2. The parent classifies lane authority and requests one batch approval at the required read/mutation level.
3. `SubagentBuilder` constructs an isolated model client for each attempt.
4. A FIFO pool allows three active model requests; queued and retry-backoff lanes consume no active slot.
5. `SubagentRunner` executes the child loop with lane-scoped tools; non-mutating lanes cannot invoke write, command, MCP, memory-mutation, or repair tools.
6. The parent stops progress I/O, atomically stages the artifact, reconciles receipts, publishes the sealed terminal artifact, and returns synthesized output.

Scheduler recovery uses an immutable, versioned wait-for snapshot. Dependency and ownership cycles are reported as deadlocks only when timers, lease expiry, outside resource owners, and unrelated capacity cannot resolve them. The state version is checked again before recovery is applied.

## Agent types

Subagent configs can specify types such as `worker`, `verifier`, and `researcher` (see `Orchestrator` task traces). Each type can carry different tool allowlists and completion gates (`subagentCompletionGates.ts`).

## User-facing usage

- Enable subagents in settings when exposed in the webview.
- Ask LUMI to delegate research or verification explicitly.
- Monitor subagent messages in the chat timeline like any other tool call.

## Safety

The parent launch is the approval boundary:

- **PreToolUse / PostToolUse hooks** apply per tool invocation.
- Read-only lanes use read auto-approval and receive a read/diagnostic tool subset; declared mutation lanes use edit auto-approval and otherwise request approval once.
- Inner tools do not prompt repeatedly after launch, but allowlists, mutation locks, budgets, and merge checks still apply.
- **Completion gates** on lanes run **sync quality checks only**; hardening audit is deferred to the parent seal barrier. Full blocking enforcement remains on parent `attempt_completion` — see [Parent-thread execution authority](parent-thread-execution-authority.md#subagent-lane-vs-parent-vs-seal).
- **I/O authority** on non-mutating lanes: read/list/search tools bypass UniversalGuard and may parallelize when the parent pool allows — see [Governed execution runbook § Fast I/O](governed-execution-runbook.md#retry-decision-flow).
- **Production mutation authority** is SQLite-only. Memory, file locks, and Broccoli fences are projections; database outages retry or fail closed and never switch the process to local authority.
- **Lease identity** is owner + epoch + fencing token + authority mode. Tokens remain decimal strings for precision safety.

## Governed swarms

Multi-lane swarms run through `GovernedSwarmCoordinator` with durable receipts and a merge gate (optimistic reconciliation before commit). Each lane declares an **execution mode** that controls whether it acquires a governed mutation lock:

| Mode | Lock by default |
|------|-----------------|
| `read_only`, `audit_only`, `planning_only`, `documentation_only`, `diagnostic_only` | Skipped |
| `mutation` (default when omitted) | Required |

### Lifecycle (production handler)

```
roadmap pressure admit → SQLite orchestration lease → audit preflight
  → classify lane intent → acquire agent roadmap projections → DAG schedule → execute lanes
  → snapshot wait-for graph → SCC/escape analysis → version re-check
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

### Patch types (workspace proposals)

| Type | Use | Evidence required |
|------|-----|-------------------|
| `attach_evidence` | Link test/artifact to item | Recommended |
| `mark_complete` | Close item on kanban | **Yes** |
| `add_blocked_reason` | Record blocker on workspace | No |
| `move_lane` | Move item between Now/Next/Later | Rationale required |
| `reopen_item` | Re-open completed item | Rationale required |
| `advisory_only` | Suggestion only — not committed | No |

See [quick reference](governed-roadmap-projection-quickref.md) for full tag syntax and rejection reasons.

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
| [Roadmap projection quick reference](governed-roadmap-projection-quickref.md) | Tags, invariants, rejection reasons — start here |
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
