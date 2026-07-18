# Agent Fast Orientation

Last validated: 2026-07-18

## Current Snapshot

- Task admission and agent loop: `src/core/task/index.ts`.
- Tool dispatch and execution policy: `src/core/task/ToolExecutor.ts` and `src/core/task/tools/`.
- Workspace-local query authority: `src/core/task/tools/executionAuthority.ts`.
- Completion diagnostics: `src/core/task/tools/completionGatePipeline.ts`.
- Durable completion: `src/core/task/tools/handlers/AttemptCompletionHandler.ts` and SQLite `task_completions` in `src/infrastructure/db/Config.ts`.
- Production lease authority: `src/core/governance/LockAuthority.ts` and `src/core/swarm/SwarmMutexService.ts`.
- Projection safety: `src/shared/governance/fileLock.ts` and `src/core/governance/BroccoliFencingAdapter.ts`.
- Scheduler liveness: `src/core/task/tools/subagent/TarjanDeadlockDetector.ts` plus versioned snapshots in `SubagentToolHandler.ts` and `LaneDAG.ts`.
- Roadmap lifecycle and advisory journal: `src/services/roadmap/`.
- Durable audit evidence: `src/shared/audit/completionAudit.ts` and `src/infrastructure/ai/Orchestrator.ts`.
- Task latency trace: `src/core/task/latency/TaskLatencyTracker.ts`.
- Sibling dependency, bounded scheduling, and invocation capture: `src/core/task/tools/siblings/`.
- Query singleflight/generation evidence: `src/core/task/tools/io/IoRequestCoalescer.ts`.
- Generation-scoped canonical path evidence: `src/core/task/tools/io/TaskPathAuthorityCache.ts`.
- Backend admission and class budgets: `src/core/task/tools/io/TaskIoBackend.ts` and `ParentIoBulkhead.ts`.
- Task/process ownership: `src/core/task/index.ts`, `src/core/task/ActionExecutor.ts`, and `ExecuteCommandToolHandler.ts`.
- Read/list/search/definition backends: `src/integrations/misc/`, `src/services/glob/`, `src/services/ripgrep/`, and `src/services/tree-sitter/`.
- Reproducible I/O fixture: `scripts/meow-io-benchmark.ts` (`npm run benchmark:meow-io`).
- Native sibling delta identity: `src/core/api/transform/tool-call-processor.ts`.

## Orientation Loop

1. Inspect `git status --short`; preserve user changes.
2. Read the smallest hot-path file and its focused tests.
3. Classify the operation as query, local reversible mutation, external side effect, or destructive action.
4. Execute under existing task authority when local and reversible.
5. Run the focused tests, `npx tsc --noEmit --pretty false`, then the relevant broader suite.

## Validated Commands

```sh
npx tsc --noEmit --pretty false
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 src/core/task/tools/subagent/__tests__/SubagentRunner.test.ts src/core/task/tools/subagent/__tests__/executionHarnessGaps.test.ts src/integrations/terminal/CommandOrchestrator.test.ts
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 src/core/task/tools/__tests__/LockAuthorityReconciliation.test.ts src/core/task/tools/subagent/__tests__/TarjanDeadlockDetector.test.ts src/core/task/tools/__tests__/TaskCompletionTerminalization.test.ts
npm run test:unit
npm run lint
npm run roadmap:audit
npm run benchmark:meow-io
```

`mocha` must use `--no-config` for a truly focused run; `.mocharc.json` otherwise adds every `src/**/__tests__/*.ts` test.

For Task-level focused tests, also require `./src/test/requires.cjs` so the VS Code shim is installed.

The benchmark reports deterministic local-fixture evidence. Its “cold” mode clears task caches only; it does not claim control over the OS page cache. Service rows intentionally call backends directly; controlled tests verify the runtime total/class budgets.

## Links

- [Agent memory](agent-memory.md)
- [Key findings](key-findings.md)
- [Troubleshooting](troubleshooting.md)
- [Common pitfalls](common-pitfalls.md)
- [Patterns](patterns.md)

## Canonical MEOW architecture references

- [Executive brief](../meow-executive-brief.md)
- [Execution philosophy](../meow-philosophy.md)
- [Technical whitepaper](../meow-whitepaper.md)
- [Operations guide](../meow-operations-guide.md)
- [ADR index](../adr/README.md)
- [Migration report](../meow-migration.md)
