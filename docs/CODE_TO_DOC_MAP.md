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
| `src/core/task/tools/completionGatePipeline.ts` | [Security](SECURITY_BEST_PRACTICES.md) · [Whitepaper §7](papers/whitepaper.md#7-approval-hooks-and-completion) |
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
