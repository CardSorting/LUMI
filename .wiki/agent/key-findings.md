# Key Findings

## 2026-07-18 Central Completion Funnel Migration

- `src/core/task/tools/completion/CompletionFunnel.ts` is the sole completion authority. One auditable monolith now owns the entire funnel: evidence collection, registry-ordered stage trace, gate decision, action guard, canonical digest, lease-fenced SQLite compare-and-swap, event publication, cache monotonicity, roadmap/swarm checks, and terminal classification.
- The durable `task_completions` row is the terminal fact. The shared `CompletionFunnelEvent` is its one modern projection across task state, message history, subagent envelopes, and webview status. Consumers select a whole newest event; they never merge fields from competing projections.
- Terminal success is monotonic: `phase: completed`, `kind: completed`, `nextAllowedAction: none`, and `attempt_completion` is forbidden. Generic resume markers and bookkeeping cannot demote it to pending; only explicit new user work can reopen a completed task.
- `AttemptCompletionHandler` is now an adapter around `runCompletionFunnelAttempt()`. The former lifecycle decision engine, snapshot builder, action guard, gate registry/evaluator, canonical lifecycle projection, receipt validation, and legacy webview panel were deleted rather than retained as compatibility authorities.
- `ToolExecutor` no longer runs a pre-handler completion circuit breaker. There is no second interception point before the funnel, and advisory diagnostic counters cannot acquire action authority.
- `FinalizationRunner` is limited to optional post-completion Knowledge Ledger maintenance. It cannot authorize, reject, reopen, seal, or publish task completion, so documentation state cannot compete with the durable completion fact.

### Verification evidence

- Completion-focused root regression set: 141 passing.
- Webview suite: 171 passing.
- Broad unit matrix: 2,161 passing and 4 expected pending with the timing-sensitive governed-execution file excluded; that file passes 20/20 in isolation (2,181 passing total).
- `npm run check-types`, `npm run lint`, `npm run check:handler-imports`, `npm run ci:build`, and `git diff --check`: passed.

## 2026-07-18 Lease Reconciliation and Terminalization Pass

- Production coordination has one authority: SQLite. `local_test` is explicit and immutable; connection/query failure surfaces `DATABASE_AUTHORITY_UNAVAILABLE` and never falls back to memory or files.
- Lease epochs and fencing tokens are generated atomically in `swarm_lock_generations`, stored as decimal `TEXT`, and carried through TypeScript as strings. Tests cover tokens above `Number.MAX_SAFE_INTEGER`.
- Acquisition persists SQLite first and then creates file, Broccoli, and memory projections. Release performs an exact-tuple SQLite delete first; later projection cleanup failure is logged without restoring the database row.
- File and Broccoli release parse records before unlinking and validate owner, epoch, token, and mode. Future `expiresAt` wins over age; malformed JSON and clock skew are structured corruption and fail closed.
- Normal reconciliation requires a database-available snapshot. The isolated `AdministrativeLockCleaner` is the only ownership override and requires a logged reason.
- Deadlock analysis uses typed wait edges and Tarjan SCCs from immutable scheduler/lane snapshots. Timers, expiring leases, resolvable outside owners, and unrelated capacity holders prevent false deadlock classification. Recovery is discarded if either state version changed.
- Completion decisions use a schema-versioned canonical SHA-256 identity and commit one `task_completions` row under `BEGIN IMMEDIATE`, verifying the live lease, freshest generation, and unchanged task state version.
- Restart delivery is idempotent; same-outcome duplicates are suppressed; terminal conflicts and same-ID/different-payload collisions fail closed.
- ACT prompts now expose only workspace/task, next required action, hard blockers, aggregate lane progress, and completion condition. Raw tokens, counters, and advisory warnings remain outside the model decision surface.

### Verification evidence

- Focused coordination/liveness/completion and governed execution regression set: 210 passing.
- Broad unit suite: 2,373 passing, 4 expected pending.
- `npx tsc --noEmit --pretty false`, `npm run lint`, protobuf lint, handler-import checks, and `git diff --check`: passed.
- Restored the Electron-native `better-sqlite3` build with `npm run rebuild:electron:better-sqlite3` after Node-based database tests.

## 2026-07-15 Subagent Concurrency and Scoped Cancellation Pass

- Scoped command cancellation via `ownerId` prevents cross-contamination of concurrent subprocesses. `CommandExecutor` independent tracking ensures cancellations target the correct processes and preserves cancellation authority across terminal acquisition races.
- Lane admission in `UseSubagentsToolHandler` now tracks pool execution slots (`running.size`) rather than yielded lifecycle states (`activeLaneExecutions`), avoiding premature queue saturation when multiple lanes start in a single tick.
- Fetching parent context asynchronously as a promise removes context retrieval from the critical subagent lane admission path, ensuring faster startup times.
- Resuming swarms requires checking that the source governed receipt is sealed and has valid integrity with a matching checksum. Missing or unsealed receipts result in restart rather than unsafe work reuse.
- Tool repetition checks (`MAX_CONSECUTIVE_IDENTICAL_CALLS = 3`) identify stuck subagents, inject self-correction nudges to re-evaluate parameters, and notify the parent swarm of toxic hotspots.
- Transcript flushes use atomic temporary files renamed on success to prevent corruption under deferred write-behind scheduling. Published envelopes require transcript durability.

## 2026-07-13 I/O Hyper-Execution Pass

- Cold path/authority work dominated scheduler-ready-to-backend-start for one small read: 1.362 ms of a 2.396 ms local fixture trace. Warm generation reuse reduced that path to 0.114 ms and the complete handoff to 0.157 ms with no filesystem calls.
- Read extraction previously performed `access` plus pathname metadata plus another open. It now uses one `open` → descriptor `stat` → bounded read, with a UTF-8 fast path and byte-correct truncation.
- Recursive listing's directory expansion caused 144 `stat` calls in the fixture. Deterministic bounded breadth-first traversal removes them, snapshots repository ignore evidence once, and emits the first page before completion.
- Search buffered the entire child output and handler cache preflight could cost more than a small `rg` invocation. Search now directly spawns the resolved executable, parses bounded JSON incrementally, caches executable/static state, coalesces identical requests, and kills/joins its owned child on cancellation.
- Coalescing occurs before class-budget acquisition, so identical waiters consume one backend slot. The global scheduler limit remains four; search and traversal backend classes are capped at two rather than raising the global fan-out.
- Authority and result caches carry workspace, filesystem, and policy generations. Late old-generation completions cannot enter the current generation, while external-path and approval evidence is never cached.
- Direct single-tool I/O now shares task cancellation with sibling I/O, is joined during abort, and performs a post-backend abort check before read history or result projection. Multi-root search failure aborts and joins sibling search workers and rejects rather than caching a false empty result.
- `apply_patch` policy targets are parsed after mutation; opaque mutating shell/MCP work reloads ignore policy before the next read. Bounded verification commands skip both the reload and result-generation rotation.
- The final result envelope no longer JSON-serializes the full payload merely to detect failure. Invocation result/presentation arrays become immutable, canonical projection writes directly by sequence, and advisory presentation cannot gate projection.

### Deterministic local-fixture evidence

These values are development-fixture measurements, not production telemetry; “cold” clears task caches but does not control the OS page cache. The ten service rows stress backends directly; the runtime total/class caps are verified separately with controlled pool tests.

| Workload | Before | After | Dominant effect |
| :--- | ---: | ---: | :--- |
| One cold small read | 4.438 ms | 1.102 ms | one open/fstat/read path |
| Large-tree list, cold | 28.430 ms | 18.247 ms | 144 metadata calls removed |
| Large-tree list, warm | 15.288 ms | 6.295 ms | reused ignore/static state |
| Four cold searches: first result | 65.224 ms | 7.437 ms | incremental output exposure |
| Repeated warm search | 15.008 ms | 0.136 ms | 8 cache hits, 0 spawns |
| Search cancellation settlement | 7.932 ms | 1.161 ms | signal → kill → close ownership |

The 577-file, ten-workload final run left active handles unchanged (`2 → 2`). Focused I/O/scheduler tests: 123 passing; TypeScript, targeted Biome, handler-import audit, and the broad unit command pass.

## 2026-07-12 Throughput Pass

- Every tool previously awaited the environment forensic probe even though its result did not authorize or reject the tool. Tool dispatch now proceeds while the advisory probe runs in the background.
- Initial API requests waited up to 10 seconds for MCP connection. The bounded admission wait is now 1 second; partial MCP degradation no longer prevents the first request.
- Task admission synchronously persisted intent classification, initialized roadmap lifecycle with possible workspace mutation, and recorded environment history. These bookkeeping operations now run off the critical path; admission does not auto-bootstrap `ROADMAP.md`.
- Workspace-local read/list/search/definition tools previously entered manual approval when auto-approval was disabled. They now reuse task authority after `.dietcodeignore` validation; external paths retain approval.
- Completion readiness evaluated the same roadmap dry-run twice. It now consumes one canonical evaluation.
- Completion audit reconstructed grounded task context from the database and synchronously waited for two persistence writes. Grounded context skips the read, audit evidence persists asynchronously, and the two writes use one batch.
- Roadmap progress log write failures previously rejected lifecycle calls. They now fail open with a 60-second retry circuit.
- Successful environment-changing commands previously failed to revoke the environment lease because the tuple's `userRejected` flag was interpreted backwards. The lease and workspace cache now invalidate after successful execution.

## Verification Evidence

- TypeScript: clean via `npx tsc --noEmit --pretty false`.
- Focused sibling/latency/cache, command, and completion-persistence suites: all passing; deterministic scheduler workloads complete in milliseconds.
- Full unit suite after both throughput passes: 2,263 passing in about 1 minute, with 4 expected pending tests.
- Full lint and handler-import audit: passed.
- Roadmap production audit: passed via `npm run roadmap:audit`.

## 2026-07-12 Sibling Concurrency Pass

- The exact serialization point was `Task.presentAssistantMessage()`: one presenter lock awaited each complete tool, advanced one cursor, and recursively admitted the next. The stream loop also awaited that presenter after every chunk, so the existing four-slot I/O bulkhead never received concurrent callers.
- Native tool deltas used one mutable `lastToolCall`; interleaved sibling indexes could inherit another call's ID/name. State is now isolated by tool-call index and emits a stable `call_id`.
- When parallel calling is enabled, complete contiguous sibling groups larger than one enter a bounded dependency batch. Local read/read and bounded verification/read work overlap. Every classified mutation shares a task-wide mutation claim; unknown tools, mutating commands, and interactive operations remain conservatively ordered.
- Tool result blocks are invocation-local for scheduled children. Presentation events are captured per invocation for workspace-local queries; non-query and interactive presentation remains shared. Execution may finish out of order, while the batch replays captured query UI and appends results in model-emission order.
- Query-only finalized native batches can start before usage bookkeeping and assistant-history persistence, then join in a `finally` barrier. Cancellation aborts the scheduler, cancels queued work, and awaits scheduler `run` promises; prompt backend interruption depends on signal support.
- Foreground command activity is now reported by `CommandExecutor`; cancellation calls the host process termination hook immediately instead of sleeping 300 ms for presentation. The VS Code process sends Ctrl+C and releases its command waiter.
- Task-local monotonic evidence now covers admission, first token/tool/progress/I/O, sibling queue/start/completion, canonical completion, visible result, and deferred persistence. Recording is bounded and fail-open.
- Cache keys include resolved target, tool, generation, query/regex, `file_pattern`, and list recursion where applicable. Local mutation replaces the task coalescer. An old-generation in-flight result can populate only its old coalescer object, not the replacement generation.

### Deterministic workload evidence

| Workload | Sequential estimate | Concurrent wall | Max concurrency |
| :--- | ---: | ---: | ---: |
| Four file reads | 280 ms | 100 ms | 4 |
| Two reads + two searches | 290 ms | 100 ms | 4 |
| Diagnostic + safe test command | 220 ms | 140 ms | 2 |
| Mutation + two disjoint reads | 230 ms | 120 ms | 3 |
| Overlapping mutations | 200 ms | 200 ms | 1 |
| One failed sibling + two successes | 190 ms | 100 ms | 3 |

These are fake-clock scheduler fixtures, not extension-host measurements. All workloads start simulated useful I/O at 0 ms, use zero queue wait when independent, preserve sequence-ordered envelopes, and retain partial successes. The cooperative cancellation fixture stops one active and two queued siblings with 0 ms fake-clock latency and leaves no fixture timer pending.
