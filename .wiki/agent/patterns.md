# Execution Patterns

## Transactional Task Lifecycle

1. Construct one typed transition intent with task, exact generation, idempotency ID, causal source, and originating operation/event identity.
2. Submit it to the task-bound `TaskLifecycleFunnel`; never submit a replacement state object.
3. Load and validate the current record, generation, state-machine edge, cancellation fence, and parent/child constraint.
4. Resolve the documented terminal conflict policy without reinterpreting another funnel's semantic fact.
5. Compare-and-swap generation plus lifecycle revision.
6. In one transaction, update the current record, append the immutable event, and allocate its monotonic sequence.
7. Project and publish only after commit.
8. Treat persistence/CAS rejection as final for that request; do not write a compatibility field.
9. Resume suspended generations explicitly and replace terminal generations atomically with a new ID.
10. Keep execution and semantic completion in their own funnels; they query or submit facts to lifecycle.

## Central Execution Funnel

1. Give every invocation a stable task-scoped invocation ID.
2. Enter `ExecutionFunnel.execute()` from parent, sibling, or subagent transport code.
3. Derive conditional mutation and collision paths from the frozen intent inside the funnel; do not maintain a second tool-name decision table in a handler or transport.
4. Normalize the operation and freeze the handler's synchronous, pure `ApprovalIntent`.
5. Evaluate mode, lane, cancellation, fencing, roadmap, hooks, execution policy, approval settings, command safety, trusted commands, and MCP policy in the ordered monolith.
6. Prompt only when policy cannot automatically admit the complete intent; record exactly one immutable decision.
7. Issue one permit linked to that decision, task generation, and invocation, then dispatch the registered adapter.
8. Validate any composite child intent is covered by the recorded parent intent before delegated dispatch.
9. Run reliability, post-hook, and post-policy observation inside the permit context.
10. Publish one deeply immutable terminal event with the original stage ordering and causal approval audit.
11. Project results deterministically and keep task completion under the separate `CompletionFunnel`.

## Database-First Lease Lifecycle

1. Run admission checks without creating a competing authority.
2. Enter `BEGIN IMMEDIATE`, allocate the next epoch/token as `bigint`, persist their decimal strings, and commit the SQLite lease.
3. Create file, Broccoli, and memory projections using the exact lease identity.
4. If projection creation fails, compare-and-delete only the lease just allocated and clean only matching projections.
5. On release, compare-and-delete SQLite by resource, owner, epoch, token, and mode first.
6. Remove exact matching projections afterward; log cleanup failure without reverting the database transition.

## Snapshot-Consistent Deadlock Recovery

1. Increment scheduler and lane versions on every relevant transition.
2. Freeze the lane DAG and copy running, pending, ownership, timer, and capacity state.
3. Build typed dependency/ownership edges and auxiliary timer/capacity edges.
4. Run Tarjan SCC over hard edges.
5. Exclude SCCs with a timer, lease-expiry, outside-owner, or capacity escape.
6. Re-read both versions immediately before recovery; if either changed, discard and recompute.

## Durable Completion CAS

1. Evaluate completion against one state version and checkpoint.
2. Build the schema-versioned canonical identity object and SHA-256 `decisionId`.
3. Read an existing durable terminal row before expensive evaluation when possible.
4. Under `BEGIN IMMEDIATE`, verify the live lease tuple, protocol/expiry, freshest generation, and unchanged task state version.
5. Return identical or same-outcome existing rows according to idempotency policy; reject payload collisions and outcome conflicts.
6. Insert and commit the terminal row before mutating in-memory terminal state or emitting final success.

## Workspace-Local Query Fast Path

1. Enter the central funnel and classify the invocation as workspace query.
2. Validate required parameters and enforce `.dietcodeignore`.
3. Resolve whether the target is inside an open workspace.
4. Evaluate workspace/external scope against the current read settings in the central approval policy; do not infer consent in the handler.
5. Skip architectural mutation guards and pre-tool observability hooks as recorded funnel stages.
6. Return the result and publish the same terminal event contract used by governed tools.

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
2. Let `ExecutionFunnel` complete any required external-path approval before reusable backend lookup; external results and approval evidence are never cacheable.
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

## Transaction-Split Completion Saga

1. In the initial tool handler, perform preflight gate checks, build the completion attempt metadata, persist the `prepared` saga row in `completion_attempts`, and return a typed continuation outcome.
2. The `ExecutionFunnel` terminalizes the original invocation, commits the terminal event, and releases the execution permit before returning control.
3. The coordinator receives the committed terminal execution event, validates its integrity using `loadTerminalExecutionEvent`, and retrieves the registered saga attempt.
4. If a validation command is required, the coordinator performs an atomic CAS claim by transitioning the phase from `evidence_pending` to `evidence_dispatching`, preventing duplicate execution races.
5. If the claim succeeds, the coordinator runs the validation command under a fresh sibling permit, verifies integrity against the resulting terminal event, and continues the proposal lifecycle (user prompting and final settlement).
6. In case of crash recovery, `reconcileForTask(config)` automatically loads unfinished attempts, checks for stale generations, and resumes the saga from its persisted phase.
