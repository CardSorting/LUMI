# Agent Memory

## Durable Constraints

- `.dietcodeignore` remains the read/write security boundary. Workspace-local query auto-authority must never bypass it.
- Command permission parsing and destructive/manual approval remain fail-closed.
- Initial checkpoints still serialize mutations, but read-only tools may proceed while the checkpoint commit is pending.
- Scheduled completion-audit persistence and roadmap finalization are best-effort. Completion audit evaluation, optional workspace audit artifacts, message persistence, and checkpoint saving still occupy synchronous portions of completion.
- Completed I/O cache entries are invalid after local mutation; reset the task coalescer generation. Unknown shell/MCP operations invalidate conservatively, and mutations affecting `.dietcodeignore` refresh policy synchronously before later reads.
- Path-authority records are immutable and scoped by workspace identity, filesystem generation, and ignore-policy generation. Never cache approval, credential, destructive-action authorization, external-path results, or mutable validation failures.
- Eligible sibling batches use a task-associated scheduler with capacity four. Backend budgets are class-specific: metadata/small reads may use four slots while repository searches and traversals are capped at two. Task abort signals and joins both sibling and direct single-operation I/O; tools must honor the invocation signal and must not project after it is aborted.
- Scheduled tool results are invocation-local. Canonical results are projected in model-emission order before advisory query-card replay; auto-approved local query presentation overlaps backend work. Non-query and interactive presentation remains shared. Do not append concurrent results directly to `TaskState.userMessageContent`.
- All sibling mutations remain one lane because the classifier adds a shared `workspace-mutation` claim. Task verification commands share a `command-lane`; mutating/unknown commands fence the workspace.
- Commands classified by the canonical JoyRide policy as `verification` or `safe-readonly` may overlap read-only diagnostics; shell operators, installs, builds, unknown commands, and environment mutations retain the workspace-wide fence.
- CommandExecutor owns shell timeout/cancellation. The outer ActionExecutor shell lane uses no competing timeout or retry, so it cannot start a replacement while an original process is alive; all advisory notification timers clear in `finally`. Scoped command cancellation is supported by passing an optional `ownerId` to `cancelBackgroundCommand(ownerId)` and checking `hasActiveBackgroundCommand(ownerId)`.
- Swarm execution lane concurrency must be controlled by tracking active execution slots in the pool (`running.size`) rather than yielded/suspended lifecycle states (`activeLaneExecutions`) to prevent premature queue saturation during setup.
- Swarm resumes must check and validate that a candidate governed authority receipt is sealed and has valid integrity with a matching checksum before reusing historical agent work; unsealed or missing receipt evidence requires the lane to restart.
- Subagents apply repetition detection (`MAX_CONSECUTIVE_IDENTICAL_CALLS = 3`) to self-correct with a nudge to re-evaluate or ask a follow-up, and signal a toxic hotspot to the parent swarm.
- Subagent completion or failure envelopes must only be published after durably flushing the transcript. Flushes must be atomic (writing to a temporary file and renaming) to prevent JSONL corruption/duplication under deferred write-behind scheduling.
- Production coordination authority is immutable `sqlite`. A database failure raises `DATABASE_AUTHORITY_UNAVAILABLE`; never adopt memory or filesystem state as fallback authority.
- Lease identity is `resource + ownerId + leaseEpoch + fencingToken + authorityMode`. Epochs and tokens are decimal strings/`bigint`, never JavaScript `number`.
- Memory, governed lock files, and Broccoli fences are projections. Reconciliation requires a database-available snapshot; malformed or clock-skewed records fail closed and remain on disk.
- `AdministrativeLockCleaner` is the only ownership override. It requires an explicit reason and is not callable through normal `LockAuthority` orchestration.
- Deadlock recovery requires a typed immutable scheduler snapshot, an SCC with no timer/lease/owner/capacity escape, and unchanged scheduler plus lane versions at apply time.
- Task completion is terminal only after the `task_completions` `BEGIN IMMEDIATE` CAS verifies the current lease generation and unchanged task state version.

## Validation Coupling

- When touching query authority, run `executionAuthority.test.ts` and `parentIoThroughput.test.ts`.
- When touching path/cache generations, run `TaskPathAuthorityCache.test.ts`, `TaskIoBackend.test.ts`, both ignore-controller suites, and `IoRequestCoalescer` coverage in `parentIoThroughput.test.ts`.
- When touching read/list/search backends, run `extract-text.test.ts`, `glob/list-files.test.ts`, `ripgrep/index.test.ts`, and `languageParserCache.test.ts`.
- When touching completion audit persistence, run `completionAuditResilience.test.ts` and `Orchestrator.test.ts`.
- When touching roadmap lifecycle or progress, run `RoadmapCompletionGate.test.ts` and `RoadmapToolJournal.test.ts`.
- When touching sibling scheduling, run the dependency, scheduler, performance, invocation-context, task-batch, tool-call processor, and parent-I/O suites under `--no-config`.
- When touching subagent concurrency, resume logic, repetition checks, or transcript recording, run `SubagentRunner.test.ts` and `executionHarnessGaps.test.ts` under `--timeout 10000`.
- When touching coordination authority or projections, run `LockAuthorityReconciliation.test.ts` and the governed execution hardening/reliability suites.
- When touching scheduler wait state or lane transitions, run `TarjanDeadlockDetector.test.ts` and `SubagentToolHandler.test.ts`.
- When touching completion identity, lease binding, or terminal persistence, run `TaskCompletionTerminalization.test.ts` plus completion lifecycle/gate tests.
