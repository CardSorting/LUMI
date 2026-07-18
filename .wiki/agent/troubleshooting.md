# Troubleshooting

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
