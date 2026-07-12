# Troubleshooting

## Focused Mocha Run Executes the Entire Suite

Symptom: passing explicit test files still runs thousands of tests.

Cause: `.mocharc.json` contributes the recursive `src/**/__tests__/*.ts` spec.

Fix:

```sh
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 <test-files>
```

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
