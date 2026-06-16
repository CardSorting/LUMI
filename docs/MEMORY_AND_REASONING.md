---
title: "AI Memory & Reasoning"
sidebarTitle: "Memory & Reasoning"
description: "How LUMI manages context, BroccoliDB memory, and the agent reasoning loop."
---

# AI Memory & Reasoning

LUMI maintains context across long tasks through a combination of conversation management, BroccoliDB graph memory, and static analysis.

## Agent loop

The active `Task` in `src/core/task/index.ts` repeats:

1. **Assemble context** — User message, rules, @ mentions, environment snapshot (`src/core/context/`).
2. **Call LLM** — `buildApiHandler` streams assistant output.
3. **Parse tools** — Tool uses extracted from the stream (`src/core/assistant-message/`).
4. **Execute tools** — `ToolExecutorCoordinator` runs handlers; hooks may modify or cancel (`src/core/hooks/`).
5. **Append results** — Tool output returns to conversation history on disk.

Plan mode restricts mutating tools via `plan_mode_respond`; Act mode uses `act_mode_respond` and full toolbelt.

## Conversation memory

| Mechanism | Location | Purpose |
|-----------|----------|---------|
| API conversation history | `src/core/storage/disk.ts` | Persisted messages per task ULID |
| Context window tracking | `src/core/context/context-management/` | Token limits, overflow errors |
| Condense / summarize | `condense`, `summarize_task` tools; `/compact` slash | Shrink history |
| File context tracker | `src/core/context/context-tracking/FileContextTracker.ts` | Files read during task |

## BroccoliDB cognitive memory

Graph-backed tools (prefix `mem_`, `query_cognitive_memory`) delegate to `@noorm/broccolidb` through handlers in `src/core/task/tools/handlers/CognitiveMemory*.ts`.

Capabilities include:

- Query and snapshot the knowledge graph
- Link, merge, and refresh nodes from workspace changes
- Blast-radius and centrality analysis for impact reasoning
- Shared memory layers for subagent/swarm coordination (`mem_claim`, `mem_release`, `mem_hubs`)

BroccoliDB storage details: [broccolidb/docs/architecture/current.md](../broccolidb/docs/architecture/current.md).

## Static analysis

- **Tree-sitter** — `src/services/tree-sitter/` for definitions and structure (`list_code_definition_names`).
- **Spider** — Forensic audit via `src/core/policy/spider/` and BroccoliDB Spider capabilities.
- **Project map tool** — `project_map` handler summarizes repository layout.

## Orchestrator

`src/infrastructure/ai/Orchestrator.ts` tracks agent streams, subagent tasks, intent classification, and audit metadata for multi-step/swarm workflows. It persists through `src/infrastructure/db/BufferedDbPool`.

## Checkpoints

File-level snapshots during tasks use `src/integrations/checkpoints/` — separate from cognitive memory but part of “what happened” recovery.

## Related

- [All tools](tools-reference/all-dietcode-tools.mdx) — memory tool names
- [Working with subagents](WORKING_WITH_SUBAGENTS.md)
- [Checkpoints](core-workflows/checkpoints.mdx)
