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

## Generation-Safe I/O Backend

1. Validate parameters and resolve immutable path authority under the task's workspace/filesystem/policy generations.
2. Complete any required external-path approval before reusable backend lookup; external results are never cacheable.
3. Look up and singleflight the semantic request before acquiring a class budget, so duplicate waiters consume one slot.
4. Acquire the centrally bounded metadata/read, search, or traversal class and pass the invocation `AbortSignal` into the backend.
5. Record backend start and first useful evidence independently from canonical completion.
6. Publish one immutable payload into the current generation only; discard late old-generation completions.
7. Project final results by model sequence, then replay advisory presentation.

For direct operations, use the task signal when no sibling invocation signal exists. Task abort must signal, join the active backend, and recheck cancellation before any history or projection mutation.

## Bounded Incremental Producer

- Apply output and result limits while consuming the producer, not after buffering it.
- Reserve marker space so truncation is represented honestly.
- Stop admitting traversal work after cancellation/limit/timeout, await active work, and release partial buffers.
- A cancelled subprocess is not settled until the owned process closes; escalation timers and listeners must be cleared on every terminal path.
- A failed multi-root producer aborts its peer producers, joins all of them, and rejects. Never normalize backend failure into a cacheable empty result.

## Owner-Scoped Command Cancellation

1. Tag running subprocesses with an `ownerId` parameter upon creation.
2. In `CommandExecutor`, map executing processes to their respective `ownerId`.
3. Cancel specific scopes using `cancelBackgroundCommand(ownerId)` without terminating other concurrently running subprocesses.
4. Check scoped status using `hasActiveBackgroundCommand(ownerId)`.

## Swarm Resume Authority Verification

1. Load the candidate governed authority receipt matching the swarm and task.
2. Verify the receipt is sealed and passes integrity checksum checks.
3. Reuse historical agent results only if the matching lane receipt is completed and claim-released.
4. Restart lanes that lack a valid, sealed governed receipt.

## Subagent Repetition Self-Correction

1. Keep a sliding history of the last 10 tool calls (`toolName:JSON.stringify(params)`).
2. Track consecutive identical tool calls.
3. If they reach the repetition threshold, inject a self-correction nudge into the LLM context.
4. Signal a toxic hotspot finding to the parent swarm.

## Atomic, Durable Transcripts

1. Support deferred write-behind transcript flushes to keep the hot path responsive.
2. Force a full flush as a durability barrier before publishing completions or failure results.
3. Perform atomic writes by writing the transcript history to a temporary file (`.tmp`) and renaming it to the final destination to prevent JSONL corruption/duplication.
