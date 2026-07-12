# HTE-002: Fast Path and Governed Mutation

**Status:** Accepted  
**Implementation:** `src/core/task/tools/executionAuthority.ts`, `src/core/task/tools/siblings/SiblingToolDependency.ts`

## Context and problem

Read-only and local reversible work was paying mutation-governance cost, while protected and destructive actions require strict controls.

## Decision

Classify operations by effect and scope. Known local queries and reversible work reuse task authority on the fast path. Protected paths, external paths, destructive/manual commands, credentials, unresolved mutation scope, and publication use the governed path.

## Alternatives and tradeoffs

One global gate was simpler to implement but serialized safe work. Fully optimistic mutation was unsafe. The split requires accurate claims, but makes authority durable and risk explicit.

## Consequences and future considerations

Read-only work does not acquire mutation authority. Scope changes trigger reclassification. New tools must declare effect and target claims.
