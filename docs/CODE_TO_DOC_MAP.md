---
title: "Code-to-Doc Map"
sidebarTitle: "Code ↔ Docs"
description: "Quick lookup: source path → documentation page."
---

# Code-to-doc map

Use this when you change code and need to update the matching doc.

## Core loop

| Source | Documentation |
|--------|---------------|
| `src/extension.ts` | [Architecture (current)](architecture/current.md) · [Project map](PROJECT_MAP.md) |
| `src/core/controller/index.ts` | [Architecture](architecture/current.md) · [Task management](core-workflows/task-management.mdx) |
| `src/core/task/index.ts` | [Whitepaper §4](papers/whitepaper.md#4-the-task-loop) · [Memory & reasoning](MEMORY_AND_REASONING.md) |
| `src/core/task/tools/ToolExecutorCoordinator.ts` | [All tools](tools-reference/all-dietcode-tools.mdx) |
| `src/shared/tools.ts` | [All tools](tools-reference/all-dietcode-tools.mdx) |
| `src/core/api/index.ts` | [Model selection](core-features/model-selection-guide.mdx) · [Providers overview](provider-config/README.mdx) |
| `src/shared/providers/providers.json` | [Providers overview](provider-config/README.mdx) |

## Safety & customization

| Source | Documentation |
|--------|---------------|
| `src/core/task/tools/autoApprove.ts` | [Auto-approve](features/auto-approve.mdx) |
| `src/core/task/tools/completionGatePipeline.ts` | [Security](SECURITY_BEST_PRACTICES.md) · [Whitepaper §7](papers/whitepaper.md#7-approval-hooks-and-completion) · [Parent-thread execution authority](parent-thread-execution-authority.md) · [Completion gate lifecycle](completion-gate-lifecycle-migration.md) · [Decision engine](completion-lifecycle-decision-engine.md) |
| `src/core/task/tools/attemptCompletionUtils.ts` | [Parent-thread execution authority](parent-thread-execution-authority.md) · [Completion gate lifecycle](completion-gate-lifecycle-migration.md) · [Decision engine](completion-lifecycle-decision-engine.md) |
| `src/core/task/tools/completion/CompletionLifecycleDecisionEngine.ts` | [Decision engine](completion-lifecycle-decision-engine.md) |
| `src/core/task/tools/completion/CompletionActionGuard.ts` | [Decision engine](completion-lifecycle-decision-engine.md) |
| `src/core/task/tools/completion/completionSnapshotBuilder.ts` | [Decision engine](completion-lifecycle-decision-engine.md) |
| `src/core/task/tools/completion/gateRegistry.ts` | [Decision engine](completion-lifecycle-decision-engine.md) |
| `src/core/task/tools/executionAuthority.ts` | [Parent-thread execution authority](parent-thread-execution-authority.md) |
| `src/core/task/ToolExecutor.ts` | [Parent-thread execution authority](parent-thread-execution-authority.md) · [Project map](PROJECT_MAP.md) |
| `src/core/policy/FluidPolicyEngine.ts` | [Parent-thread execution authority](parent-thread-execution-authority.md) · [Architectural enforcement](ARCHITECTURAL_ENFORCEMENT.md) |
| `src/core/hooks/hook-factory.ts` | [Hooks](customization/hooks.mdx) |
| `src/core/ignore/DietCodeIgnoreController.ts` | [dietcodeignore](customization/dietcodeignore.mdx) |
| `src/services/roadmap/` | [Roadmap steering](features/roadmap-steering.mdx) · [Auto-governance post-mortem](features/roadmap-auto-governance-postmortem.mdx) |
| `src/services/roadmap/RoadmapAutoGovernance.ts` | [Auto-governance post-mortem](features/roadmap-auto-governance-postmortem.mdx) |
| `src/services/roadmap/RoadmapCompletionGate.ts` | [Roadmap steering](features/roadmap-steering.mdx) · [Auto-governance post-mortem](features/roadmap-auto-governance-postmortem.mdx) |

## UI & host

| Source | Documentation |
|--------|---------------|
| `webview-ui/src/copy/lumiVoice.ts` | [USER_INTERFACE_DESIGN.md](USER_INTERFACE_DESIGN.md) · [MIRA_UX_IMPLEMENTATION.md](MIRA_UX_IMPLEMENTATION.md) |
| `src/shared/grpc/persistent-stream.ts` | [gRPC subscription persistence](grpc-subscription-persistence.md) |
| `webview-ui/src/services/grpc-subscription-runtime.ts` | [gRPC subscription persistence](grpc-subscription-persistence.md) |
| `webview-ui/src/services/grpc-client-base.ts` | [gRPC subscription persistence](grpc-subscription-persistence.md) · [System communication](SYSTEM_COMMUNICATION.md) |
| `webview-ui/src/context/useExtensionGrpcSubscriptions.ts` | [gRPC subscription persistence](grpc-subscription-persistence.md) |
| `src/core/controller/persistent-subscription-hub.ts` | [gRPC subscription persistence](grpc-subscription-persistence.md) |
| `src/core/controller/**/subscribeTo*.ts` | [gRPC subscription persistence](grpc-subscription-persistence.md) · [System communication](SYSTEM_COMMUNICATION.md) |
| `src/hosts/host-provider.ts` | [System communication](SYSTEM_COMMUNICATION.md) |
| `src/hosts/vscode/hostbridge/` | [System communication](SYSTEM_COMMUNICATION.md) |

## Subagents & memory

| Source | Documentation |
|--------|---------------|
| `src/core/task/tools/subagent/` | [Subagents feature](features/subagents.mdx) · [WORKING_WITH_SUBAGENTS.md](WORKING_WITH_SUBAGENTS.md) |
| `src/core/task/tools/subagent/LockNecessity.ts` | [Governed subagent execution](governed-subagent-execution.md) · [Schema](governed-execution-schema.md) · [Runbook](governed-execution-runbook.md) · [Decisions](governed-execution-decisions.md) |
| `src/core/task/tools/subagent/ParentAgentFlowControl.ts` | [Parent-thread execution authority](parent-thread-execution-authority.md) · [Runbook](governed-execution-runbook.md) |
| `src/core/task/tools/subagentCompletionGates.ts` | [Parent-thread execution authority](parent-thread-execution-authority.md) · [Working with subagents](WORKING_WITH_SUBAGENTS.md) |
| `src/core/task/tools/subagent/GovernedSwarmCoordinator.ts` | [Governed subagent execution](governed-subagent-execution.md) · [Execution authority](governed-execution-authority.md) · [Schema](governed-execution-schema.md) · [Runbook](governed-execution-runbook.md) |
| `src/core/task/tools/subagent/GovernedIntegration.ts` | [Governed subagent execution § roadmap/audit](governed-subagent-execution.md#roadmap-and-audit-integration) · [Schema § GovernedRoadmapLinkage](governed-execution-schema.md#governedroadmaplinkage) |
| `src/core/task/tools/handlers/SubagentToolHandler.ts` | [Working with subagents](WORKING_WITH_SUBAGENTS.md) · [Runbook § crash seal](governed-execution-runbook.md) |
| `src/core/task/tools/subagent/MergeGate.ts` | [Governed subagent execution](governed-subagent-execution.md) · [Runbook § violation catalog](governed-execution-runbook.md#violation-catalog) |
| `src/core/task/tools/subagent/GovernedExecutionStore.ts` | [Schema § artifact layout](governed-execution-schema.md#artifact-layout) |
| `src/core/task/tools/subagent/ReplayValidator.ts` | [Schema § replay checksum](governed-execution-schema.md#replay-checksum-canonical-form) · [Decisions ADR-006](governed-execution-decisions.md#adr-006-replay-checksum-canonicalization) |
| `src/core/governance/LockAuthority.ts` | [Governed subagent execution § lock stack](governed-subagent-execution.md#lock-authority-stack) · [Decisions ADR-002](governed-execution-decisions.md#adr-002-unified-lock-authority-with-layered-backends) |
| `src/shared/subagent/roadmapProjection.ts` | [Schema § Roadmap projection types](governed-execution-schema.md#roadmap-projection-types) · [Architecture § Per-agent roadmap projection](governed-subagent-execution.md#per-agent-roadmap-projection) |
| `src/core/task/tools/subagent/AgentRoadmapProjection.ts` | [Architecture § Per-agent roadmap projection](governed-subagent-execution.md#per-agent-roadmap-projection) |
| `src/core/task/tools/subagent/RoadmapPatchQualityGate.ts` | [Architecture § Per-agent roadmap projection](governed-subagent-execution.md#per-agent-roadmap-projection) · [Decisions ADR-012](governed-execution-decisions.md#adr-012-projection-hardening-quality-gate-containment-rebase) |
| `src/core/task/tools/subagent/RoadmapLocalEventContainment.ts` | [Architecture § Per-agent roadmap projection](governed-subagent-execution.md#per-agent-roadmap-projection) · [Runbook § Roadmap projection](governed-execution-runbook.md#roadmap-projection-operator) |
| `src/core/task/tools/subagent/RoadmapPatchReconciler.ts` | [Architecture § Per-agent roadmap projection](governed-subagent-execution.md#per-agent-roadmap-projection) · [Schema § RoadmapPatchReconciliation](governed-execution-schema.md#roadmappatchreconciliation) |
| `src/core/task/tools/subagent/RoadmapWorkspaceCommit.ts` | [Quick reference](governed-roadmap-projection-quickref.md) · [Architecture § Per-agent roadmap projection](governed-subagent-execution.md#per-agent-roadmap-projection) · [Decisions ADR-011](governed-execution-decisions.md#adr-011-per-agent-roadmap-projection-coordinator-owned-workspace-commits) |
| `docs/governed-roadmap-projection-quickref.md` | [Governed subagent execution](governed-subagent-execution.md) · [Runbook](governed-execution-runbook.md) · [Schema](governed-execution-schema.md) |
| `src/core/task/tools/subagent/RoadmapMutation.ts` | [Architecture § Roadmap three planes](governed-subagent-execution.md#roadmap-three-planes) |
| `webview-ui/src/components/chat/subagent/GovernedReceiptPanel.tsx` | [Runbook § incident console](governed-execution-runbook.md#incident-console-ui-map) · [Runbook § Roadmap projection](governed-execution-runbook.md#roadmap-projection-operator) |
| `src/core/task/tools/handlers/CognitiveMemory*.ts` | [Memory & reasoning](MEMORY_AND_REASONING.md) · [api/README.md](api/README.md) |
| `src/core/policy/spider/` | [Spider forensic engine](architecture/spider-v20-forensic-engine.md) |

## BroccoliDB (substrate)

| Source | Documentation |
|--------|---------------|
| `broccolidb/` | [broccolidb/docs/README.md](../broccolidb/docs/README.md) |
| `broccolidb/core/public-api.ts` | [broccolidb/docs/public-api.md](../broccolidb/docs/public-api.md) |

## Papers (agent layer)

| Doc type | Path |
|----------|------|
| Values | [papers/philosophy.md](papers/philosophy.md) |
| Metrics | [papers/companion-brief.md](papers/companion-brief.md) |
| Engineering | [papers/whitepaper.md](papers/whitepaper.md) |
| Two-layer hub | [AGENT_STACK.md](AGENT_STACK.md) |
