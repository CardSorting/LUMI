# Agent Memory

## Durable Constraints

- `.dietcodeignore` remains the read/write security boundary. Workspace-local query auto-authority must never bypass it.
- Command permission parsing and destructive/manual approval remain fail-closed.
- Initial checkpoints still serialize mutations, but read-only tools may proceed while the checkpoint commit is pending.
- Scheduled completion-audit persistence and roadmap finalization are best-effort. Completion audit evaluation, optional workspace audit artifacts, message persistence, and checkpoint saving still occupy synchronous portions of completion.
- Completed I/O cache entries are invalid after local mutation; reset the task coalescer generation.
- Eligible sibling batches use a task-associated scheduler with capacity four. Task abort waits for the batch promise; tools must honor the invocation signal for prompt interruption.
- Scheduled tool results are invocation-local. Workspace-local query UI is captured per invocation, then replayed in model-emission order. Non-query presentation remains shared. Do not append concurrent results directly to `TaskState.userMessageContent`.
- All sibling mutations remain one lane because the classifier adds a shared `workspace-mutation` claim. Task verification commands share a `command-lane`; mutating/unknown commands fence the workspace.
- Commands classified by the canonical JoyRide policy as `verification` or `safe-readonly` may overlap read-only diagnostics; shell operators, installs, builds, unknown commands, and environment mutations retain the workspace-wide fence.
- User-owned `package.json` name change is present in the working tree and is unrelated to the throughput pass.

## Validation Coupling

- When touching query authority, run `executionAuthority.test.ts` and `parentIoThroughput.test.ts`.
- When touching completion audit persistence, run `completionAuditResilience.test.ts` and `Orchestrator.test.ts`.
- When touching roadmap lifecycle or progress, run `RoadmapCompletionGate.test.ts` and `RoadmapToolJournal.test.ts`.
- When touching sibling scheduling, run the dependency, scheduler, performance, invocation-context, task-batch, tool-call processor, and parent-I/O suites under `--no-config`.
