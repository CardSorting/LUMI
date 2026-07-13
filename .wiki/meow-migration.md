# MEOW: Migration and Evolution Report

**MEOW (Model-Efficient Order-aware Workflow)** is the execution architecture governing parallel tool dispatch, structured task ownership, deterministic projection, and authoritative completion.

## Purpose

This report preserves the transition from the previous execution model to the implemented MEOW architecture. It is historical context for future maintainers, not a proposal for another rewrite.

---

## Previous model

The former path coupled stream handling, presentation, and execution:

```text
stream chunk -> shared presenter lock -> execute tool -> append shared content
             -> update last message -> await persistence/diagnostics
             -> recurse to next tool block
```

The presenter effectively owned admission. A single mutable current-tool state and shared message updates meant that even independent reads waited for the previous sibling. Native tool deltas could reset a cursor and completion-order appends were difficult to project deterministically. Governance and evidence work had more opportunities to appear as synchronous gates than their risk justified.

---

## Implemented model (MEOW)

```text
stream -> per-index tool identity -> contiguous sibling window
       -> claims/edges -> bounded task-owned scheduler (MEOW)
       -> invocation-local envelopes -> stable projection
       -> one completion validation -> authoritative result
       -> async audit/roadmap persistence -> child join/finalize
```

The migration was incremental. Existing authority, workspace policy, approvals, checkpoint, rollback, receipts, and completion semantics were retained. The change extracted only the concurrency boundary and the evidence needed to prove it.

---

## Why each change happened

### Completion semantics

`AttemptCompletionHandler` became the sole canonical completion decision because downstream diagnostics and persistence could not legitimately overturn a valid result. This removed repeated lifecycle checks from the response path while retaining direct validation failures.

### Presentation no longer owns execution

When parallel calling is enabled, `Task.presentAssistantMessage()` gathers consecutive complete sibling blocks and delegates groups larger than one to the scheduler. `ToolInvocationContext` isolates result storage for the batch and captures presentation for workspace-local queries. Non-query and interactive presentation remains shared. Final batch results are appended in sequence order.

### Governance moved off the critical path

Pending completion-audit persistence is scheduled after completion-result presentation, and roadmap finalization is scheduled later in the completion branch. Completion audit evaluation, optional audit workspace-artifact persistence, message persistence, and checkpoint saving remain synchronous portions of completion. Material safety controls remain in their existing executor and completion paths.

### Authority became reusable

Fast local reads and reversible work reuse the task's existing authority. Mutation authority is acquired only for mutation scope and is not repeatedly reacquired for each sibling query.

### Cache generations became necessary

Overlapping reads made “clear the cache” insufficient: an old in-flight completion could repopulate a new cache. `IoRequestCoalescer` now separates generations and target identity, and mutation invalidation is narrow where safe.

### Sibling scheduling was introduced

Claims and dependency edges distinguish independent reads from the task-wide mutation lane, command environment barriers, approvals, checkpoint prerequisites, and explicit result references. The scheduler is bounded and task-owned rather than global.

---

## Before-and-after traces

### Four independent reads

Before: `read A (70) -> read B (70) -> read C (70) -> read D (70) = 280 ms estimate`.  
After: all four ready children start together and complete in a deterministic projection at 100 ms wall time; maximum concurrency four.

### Mutation plus independent reads

Before: the mutation gate delayed all siblings.  
After: the mutation retains its governed lane while two disjoint reads run concurrently; 230 ms estimate becomes 120 ms. Reads queued after invalidation use the new cache generation.

### Overlapping mutations

Before and after in the deterministic scheduler fixture: the two mutations remain serialized at 200 ms, maximum concurrency one. The immediate cause in the dependency model is the shared `workspace-mutation` write claim (with shared presentation claims as an additional conservative boundary), not a measured diff-provider lock in this test.

### One failed independent sibling

Before: a sequential all-or-nothing path could delay usable results behind the failed child.  
After: successful siblings complete and remain usable beside the individual failure; 190 ms estimate becomes 100 ms.

---

## Measured evidence

| Workload | Sequential estimate | New wall time | Queue wait | Safety behavior |
| --- | ---: | ---: | ---: | --- |
| Four independent reads | 280 ms | 100 ms | 0 ms | concurrent |
| Two reads + two searches | 290 ms | 100 ms | 0 ms | concurrent |
| Diagnostic + read-only test command | 220 ms | 140 ms | 0 ms | separate safe lanes |
| Mutation + two disjoint reads | 230 ms | 120 ms | 0 ms | mutation governed |
| Overlapping mutations | 200 ms | 200 ms | 60 ms average | serialized |
| Failed sibling + successes | 190 ms | 100 ms | 0 ms | partial success |

The latency tracker fixture proves event coverage, not provider performance: admission 5 ms, first token 7 ms, first useful I/O 12 ms, authoritative-to-visible 5 ms, persistence 10 ms. Production task snapshots are the source for host-specific measurement.

---

## Safety guarantees preserved

The sibling batch still executes every child through `ToolExecutor`, so `.dietcodeignore`, workspace boundaries, external-path approval, destructive/manual command approval, credentials/protected paths, rollback, receipts, publication controls, and direct validation are not bypassed by the scheduler. Checkpoint readiness is an admission predicate for mutation-like nodes. Task abort cancels the scheduler and waits for the batch promise; backend interruption depends on signal support. Old I/O completions cannot populate the replacement coalescer generation.

---

## Intentionally serialized work

The following remain ordered because the implementation has a concrete shared resource or protocol requirement:

- all classified sibling mutations through the shared `workspace-mutation` claim;
- unknown tools and mutating commands through a workspace-wide fence;
- commands mutating shared environment state;
- unresolved interactive approval;
- mutations before the first-mutation checkpoint is ready;
- destructive or externally visible operations;
- explicit model-produced prerequisite/result-reference edges;
- final canonical completion and stable result projection.

---

## Residual technical debt

1. The task-wide mutation claim prevents even disjoint sibling writes from overlapping; narrowing it would also require validating diff/presentation ownership.
2. XML tool calls discovered in separate stream chunks may miss the same sibling window.
3. Some filesystem and subprocess APIs cannot abort mid-operation; cancellation is prompt at the scheduler boundary and cooperative for commands.
4. Captured query presentation no longer controls sibling admission, but shared non-query presentation and final message persistence remain synchronous.
5. Deterministic fixtures do not replace live provider and host latency measurements.

---

## What future work should not change casually

Do not restore a shared current-tool lock, make audit persistence synchronous, add a second completion authority, use unbounded `Promise.all`, or replace resource claims with a workspace-wide lock. Do not broaden mutation authority to make a query easier. Any proposed serialization must identify the concrete resource or protocol failure it prevents and include a barrier-based test plus a latency snapshot.

---

## Backward compatibility guarantees

The MEOW/ACC optimization pass maintains strict backward compatibility for all existing tool handlers:
1. **Presenter Fallback:** If parallel tool calling is disabled, or a turn contains a single tool call, the execution path falls back to the legacy single-lane presenter lock automatically.
2. **Transparent Sibling Execution:** Tool handlers execute within isolated, invocation-local environments. They do not need to register with the scheduler, maintain state across siblings, or manage concurrent lanes.
3. **Optional Abort Handling:** Handlers that do not consume `AbortSignal` remain fully functional; their cancellation remains cooperative or relies on process-level termination hooks managed by the executor.

---

## Subsystem impact file map

The architectural roles of the key modified source files are mapped below:

| File path | Subsystem | Architectural Role |
| :--- | :--- | :--- |
| `src/core/task/index.ts` | Task entry & dispatch | Orchestrates the primary task loop, parses incoming streams, groups sibling batches, and coordinates deterministic projection. |
| `src/core/task/ToolExecutor.ts` | Execution gate | Enforces safety validations and manages cache generation increments during mutations. |
| `src/core/task/tools/siblings/SiblingToolScheduler.ts` | Sibling Scheduler | Enforces scheduling limits (budget of 4) and handles concurrent queueing and dispatch. |
| `src/core/task/tools/siblings/SiblingToolDependency.ts` | Sibling Classifier | Maps tool calls to resource claims and builds the dependency graph with conflict edges. |
| `src/core/task/tools/siblings/ToolInvocationContext.ts` | Sibling Isolation | Captures and buffers presentation updates to prevent sequential execution blocks. |
| `src/core/task/tools/io/IoRequestCoalescer.ts` | Cache & Coalescing | Single-flights identical queries and dedupes concurrent I/O operations. |
| `src/core/task/tools/io/TaskIoBackend.ts` | Backend Admission | Coordinates cache checking, bulkhead budget entry, and actual query execution. |
| `src/core/task/tools/io/TaskPathAuthorityCache.ts` | Path Authority Cache | Resolves canonical target paths, workspace containment, and ignore policies synchronously. |
| `src/core/task/tools/io/ParentIoBulkhead.ts` | Bulkhead Limits | Restricts concurrency by resource classes (small reads: 4, searches: 2, traversals: 2). |
| `src/services/glob/list-files.ts` | BFS Glob Listing | Performs bounded directory traversal without stat calls and streams early results. |
| `src/services/ripgrep/index.ts` | Ripgrep Search | Directly spawns searches and parses json output incrementally to prevent thread blocking. |
| `src/services/tree-sitter/index.ts` | Treesitter Parsing | Memoizes grammars, parser allocations, and query compilations. |

---

## Validation record

The implementation pass recorded the full unit suite at 2,263 passing and 4 pending, a targeted presentation-failure run at five passing, and successful TypeScript, lint, and roadmap-audit runs. The documentation grounding pass reran 44 focused dependency, scheduler, batch, cache, latency, and completion-audit tests successfully.

The stabilization and closure pass on July 13, 2026, verified:
- 71 focused MEOW/ACC tests passing (126ms)
- TypeScript checks (`check-types`) clean
- Biome lint checked 1,830 files clean
- Roadmap audit passed
- Doc links checked clean (24 required, 109 scanned)
- `git diff --check` clean

Benchmark and latency fixtures use fake clocks or controllable deferred operations. No live provider or extension-host benchmark is claimed.
