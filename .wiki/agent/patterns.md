# Execution Patterns

## Workspace-Local Query Fast Path

1. Validate required parameters.
2. Enforce `.dietcodeignore`.
3. Resolve whether the target is inside an open workspace.
4. Reuse task authority for local query I/O; retain approval for external paths.
5. Skip architectural mutation guards and pre-tool observability hooks.
6. Return the result, then record lightweight evidence.

## Advisory Shift-Right

1. Compute the task-local authoritative result.
2. Return or publish that result.
3. Persist audit/progress evidence asynchronously.
4. Catch persistence failure and apply bounded retry/circuit behavior.

Use only for advisory evidence. Destructive authorization, command permission checks, ignore-policy checks, and checkpoint integrity remain synchronous.

## Single-Pass Validation

Build one canonical snapshot per lifecycle decision and pass its result downstream. Do not call the same roadmap, audit, or workspace scan once to format an error and again to decide severity.

## Task-Scoped Sibling Batch

1. Assign a stable sequence and invocation ID in model-emission order.
2. Resolve workspace locality and canonical resource targets.
3. Add backward edges only for path overlap, exclusive command/mutation state, explicit result dependency, or completion barriers.
4. Admit ready work through the four-child scheduler; checkpoint readiness gates only mutation nodes and does not consume capacity.
5. Capture query presentation and result blocks in an invocation-local envelope.
6. Join every active/queued child, retain independent failures individually, and project UI/results by sequence.
7. Run one authoritative completion decision, publish the result, then schedule advisory persistence.

## Mutation-Aware Query Evidence

- A read before an overlapping mutation is pre-mutation evidence; the mutation waits for it.
- A read after an overlapping mutation waits and uses the new coalescer generation.
- A disjoint read may overlap a mutation.
- Apply-patch target headers become individual path claims; an unparseable or targetless mutation receives a workspace-wide claim.
- All diff-backed writes still serialize until the singleton diff buffer is replaced with per-invocation state.
