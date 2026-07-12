# HTE-006: Dependency-Based Scheduling

**Status:** Accepted  
**Implementation:** `src/core/task/tools/siblings/SiblingToolDependency.ts`

## Context and problem

“All tools conflict” was an easy but overly broad approximation. It hid independent work behind workspace-wide serialization.

## Decision

Build path/resource claims and backward conflict, prerequisite, barrier, and result-reference edges in model-emission order. All mutations share a task-wide mutation claim. Unknown tools and mutating commands receive workspace-wide fences; independent reads do not.

## Alternatives and tradeoffs

Global locking avoids classification bugs but destroys throughput. Best-effort parallelism without claims risks stale reads and conflicting writes. Explicit claims require tool-specific maintenance but make ordering explainable.

## Consequences and future considerations

Path identities must remain canonical. The current model is deliberately conservative and does not prove disjoint-write independence. Narrow a broad claim only with conflict, cache, presentation, and rollback evidence.
