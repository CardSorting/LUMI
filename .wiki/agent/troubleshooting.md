# Troubleshooting

## Task Lifecycle Status Disagrees or Never Settles

Symptom: one surface says active or complete while another remains pending, cancellation never settles, or an old resumed callback changes the current task.

Response:

1. Inspect `TaskState.lifecycleFunnelRecordJson` and `lifecycleFunnelEventJson`.
2. Match `taskId`, `generationId`, `lifecycleRevision`, `lastEventId`, and `monotonicSequence`.
3. Treat only the committed record/event as lifecycle truth. Completion events, execution events, transcripts, receipts, and UI flags cannot synthesize task state.
4. If cancellation is `requested`, verify new execution is fenced and that resource cleanup is followed by `SettleCancellation`.
5. If an old generation appears, fix the caller to submit its original generation and accept `stale_generation`; never reinterpret it against the current record.
6. If persistence fails or CAS rejects, preserve the newer record. Do not repair it with a direct assignment.
7. Run the focused lifecycle suite and `npm run check:task-lifecycle-boundary`.

Focused proof:

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --timeout 10000 --exit --extension ts --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs src/core/task/lifecycle/__tests__/TaskLifecycleFunnel.test.ts src/core/task/tools/execution/__tests__/ExecutionFunnel.test.ts src/core/task/tools/completion/__tests__/CompletionFunnel.test.ts
```

## Tool Status Disagrees Across Parent, Sibling, or Subagent Views

Symptom: one surface says a tool succeeded or failed while another remains pending, or the agent stops after a handler returned a result.

Meaning: a consumer is inferring execution state from handler text, transient presentation flags, or an older invocation instead of consuming the central event.

Response:

1. Inspect `TaskState.executionFunnelEventJson`; for sibling/subagent work, inspect the invocation context or envelope `executionFunnelEvent`.
2. Match the exact `taskId`, `taskGeneration`, and `invocationId`, then require `terminal: true`.
3. Read `approvalIntent`, `approvalPolicyInputs`, `approvalDecision`, `permitDecisionId`, `phase`, and ordered `stages`; the decisive failed stage is the complete gate audit.
4. Route the caller through `ExecutionFunnel.execute()` and consume its returned event. Do not call a handler or policy directly.
5. If dispatch reports a missing permit, fix the bypassing caller rather than adding a coordinator wrapper. The coordinator is a registry only.
6. Keep tool execution and task completion distinct: `operation_succeeded` does not mean the task is complete.

Focused proof:

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs src/core/task/tools/execution/__tests__/ExecutionFunnel.test.ts src/test/tool-executor-hooks.test.ts src/core/task/tools/siblings/__tests__/SiblingToolDependency.test.ts src/core/task/tools/siblings/__tests__/SiblingToolScheduler.test.ts src/core/task/tools/subagent/__tests__/SubagentRunner.test.ts src/core/task/tools/subagent/__tests__/executionEnvelope.test.ts --timeout 10000 --exit
```

## Approval Is Pending Forever or Automatic Approval Ignores Settings

Symptom: one UI surface waits for consent while another claims approval, or a disabled approval action still dispatches.

Response:

1. Inspect the one `ExecutionFunnelEvent` for the current task generation and invocation; the legacy execution booleans no longer exist.
2. Require ordered `approval.intent`, `approval.settings`, `approval.automatic`, `approval.prompt`, `approval.decision`, then `permit.issue` stages. `permit.issue` must be absent for denial, cancellation, expiry, malformed settings, and prompt failure.
3. Confirm `permitDecisionId === approvalDecision.decisionId`, and that the decision links the same `intentId`, task generation, and invocation.
4. If the intent is missing or malformed, fix `getApprovalIntent(block)` in the handler. Do not add a default approval or compatibility conversion.
5. If a composite child is rejected, declare its capability/path/exact command in the parent intent or split it into another invocation. Never bypass delegated coverage validation.
6. Re-run `ExecutionFunnel.test.ts` under `--no-config` and the parent/sibling/subagent parity suites.

## Completion UI Says Pending After Durable Success

Symptom: task history or the database says the task completed, while a header, resume card, or finalization view still says pending.

Meaning: a consumer is deriving a second completion projection or selecting stale presentation state instead of the modern funnel event.

Response:

1. Inspect the `task_completions` row and `TaskState.completionFunnelEventJson`.
2. Confirm the terminal event has `phase: "completed"`, `kind: "completed"`, `nextAllowedAction: "none"`, and forbids `attempt_completion`.
3. Trace the ordered `stages` array and `decisionId`/`completionId` in `CompletionFunnel.ts`; this is the entire authoritative audit trail.
4. Make the consumer use `resolveCompletionFunnelEvent()` or `getTaskCompletionEvidence()`. Do not add a local lifecycle reducer or merge partial snapshots.
5. If a generic resume marker follows terminal success, preserve completion. Reopen only for explicit new user work.

Focused proof:

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs src/core/task/tools/completion/__tests__/CompletionFunnel.test.ts src/core/task/tools/completion/__tests__/completionFunnelHardening.test.ts src/core/task/tools/__tests__/TaskCompletionTerminalization.test.ts src/shared/completion/__tests__/completionFunnelMessages.test.ts src/shared/completion/__tests__/taskCompletionEvidence.test.ts --timeout 10000 --exit
```

## SQLite Coordination Authority Is Unavailable

Symptom: lock acquisition, reconciliation, fencing validation, or completion persistence raises `DATABASE_AUTHORITY_UNAVAILABLE`.

Meaning: production authority cannot be read safely. Memory, governed lock files, and Broccoli fence files are projections and cannot substitute for SQLite.

Response:

1. Preserve the projection files and current database files.
2. Restore the configured persistent SQLite connection.
3. Retry reconciliation from a fresh snapshot.
4. If authority remains unavailable, fail closed. Do not select `local_test` or delete lock files.

## Projection Record Is Malformed or Clock-Skewed

Symptom: reconciliation reports filesystem/Broccoli corruption, invalid identity fields, or `expiresAt < claimedAt`.

Response: preserve the file and inspect it. Normal runtime intentionally does not unlink corrupt records. Once SQLite is available, reconcile from the authoritative lease. If an emergency override is required, use `AdministrativeLockCleaner` through controlled administrative tooling with a non-empty reason; never use a direct recursive delete.

## Node Database Tests Report a Native Module ABI Mismatch

Symptom: Node-based completion/coordination tests cannot load `better-sqlite3` after it was built for Electron.

Test workflow:

```sh
npm rebuild better-sqlite3
# run Node/Mocha database tests
npm run rebuild:electron:better-sqlite3
```

Always restore the Electron build after the Node test run. Typecheck and lint do not replace the focused multi-connection database tests.

## Focused Mocha Run Executes the Entire Suite

Symptom: passing explicit test files still runs thousands of tests.

Cause: `.mocharc.json` contributes the recursive `src/**/__tests__/*.ts` spec.

Fix:

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 <test-files>
```

Do not run two broad unit suites concurrently. Several governed-execution tests intentionally exercise process-global authority state; concurrent copies can interfere even though each suite passes sequentially.

## Roadmap Progress Path Is Not Writable

Symptom: `EPERM` writing `~/.dietcode/session/roadmap-progress.jsonl`.

Behavior after 2026-07-12: lifecycle continues and retries persistence after a 60-second cooldown. For tests that need actual files, set `DIETCODE_SESSION_DIR` to a writable temporary directory.

## Import Aliases Fail in Mocha

Symptom: `Cannot find package '@/shared'`.

Fix: set `TS_NODE_PROJECT=./tsconfig.unit-test.json` and require `tsconfig-paths/register` as shown above.

## Focused Task Test Cannot Find `vscode`

Symptom: importing `src/core/task/index.ts` fails through `get-latest-output.ts`.

Fix: add `--require ./src/test/requires.cjs` to the focused Mocha command. That shim is normally loaded by `.mocharc.json`, but `--no-config` intentionally disables it.

## Sibling Batch Waits After Checkpoint Completion

Symptom: mutation nodes remain pending after the initial checkpoint has settled.

Cause: scheduler readiness changed, but the admission loop was not awakened.

Fix: update the readiness flag and call `SiblingToolScheduler.signalReady()`. Do not poll or spend an execution slot awaiting the checkpoint.

## Native Sibling Calls Share the Wrong Tool Identity

Symptom: interleaved OpenAI-compatible deltas attach arguments to a neighboring tool call.

Check `ToolCallProcessor` state by delta `index`. Each index must retain its own ID/name and emit the ID as both `call_id` and function ID.

## MEOW I/O Benchmark Fails Under `tsx`

Symptom: the benchmark fails while resolving extension-host-only package exports (for example `unicorn-magic`) even though unit tests work.

Fix: use the validated package script, which matches the unit-test TypeScript resolver and runs transpile-only:

```sh
npm run benchmark:meow-io
```

Interpretation: the report is a deterministic 577-file fixture. “Cold” means task-cache cold, not guaranteed OS-page-cache cold. Confirm `activeHandleDelta` is zero after cancellation workloads.

## Cancelled Direct Search Projects a Late Result

Symptom: cancelling one non-sibling search stops the task UI, but a result or read-history entry appears later.

Check that `TaskIoBackend` falls back to `TaskConfig.taskSignal`, `Task.abortTask()` aborts and joins `activeSingleIoPromise`, and ToolExecutor checks the signal immediately after the handler returns. Do not fix this with polling or a detached kill timer.

## Subagent Stuck in Repetition Loop

Symptom: A subagent runs in a loop executing the same tool with identical inputs consecutively.

Cause: The agent is stuck in an architectural loop, context drift, or lacks direction.

Mitigation: The `SubagentRunner` detects loops when consecutive identical tool calls exceed the threshold of 3. It will inject a `[SELF-CORRECTION NUDGE]` into the assistant turn and signal a `TOXIC HOTSPOT DETECTED` to the parent swarm. If the agent continues to loop, re-evaluate parameters manually, use a different strategy, or use `ask_followup_question` to seek guidance.

## Completed Agents Restarted on Swarm Resume

Symptom: Resuming a swarm execution restarts agents that were already marked "completed" in previous attempts.

Cause: The resume plan requires verification of a sealed governed authority receipt (`subagent_executions/<swarmId>.governed.json`) and a valid integrity checksum. If the receipt is unsealed, missing, or fails validation, agent results cannot be safely reused.

Fix: Verify that the previous swarm run completed successfully up to a checkpoint and produced a sealed governed receipt. If the previous attempt was abruptly interrupted before sealing, the agent lanes must be restarted to guarantee workspace state integrity.
