# Agent Fast Orientation

Last validated: 2026-07-18

## Current Snapshot

- Task admission and agent loop: `src/core/task/index.ts`.
- Task lifecycle authority: `src/core/task/lifecycle/TaskLifecycleFunnel.ts`. It alone commits generation-bound registration, activation, suspension, resume/replacement, cancellation request/settlement, completion, failure, timeout, and attached parent/child propagation.
- Lifecycle persistence: `src/core/task/lifecycle/TaskLifecyclePersistence.ts`. SQLite compare-and-swap persists the current record plus immutable event before publication; `TaskState` and the webview are projections only.
- Cancellation is transactional: `RequestCancellation` immediately fences new execution, task-owned resources settle, then `SettleCancellation` commits terminal `cancelled`. Terminal generations never reactivate; continuation requires an explicit new generation.
- Tool execution authority: `src/core/task/tools/execution/ExecutionFunnel.ts`. This auditable monolith owns parent, sibling, and subagent approval preparation, settings/policy evaluation, prompting, the one immutable decision, decision-linked permits, dispatch, reliability, and terminal classification.
- Approval is execution admission: a permit cannot exist until the funnel records an approved decision for the same task generation and invocation. Handlers synchronously declare a pure `ApprovalIntent`; they never read approval settings, prompt for operation consent, record a decision, or issue a permit.
- Execution adapters: `src/core/task/ToolExecutor.ts`, registry-only `ToolExecutorCoordinator.ts`, sibling invocation contexts, and subagent runners consume the single `ExecutionFunnelEvent`; they do not derive execution or approval state from handler text.
- Workspace-local query authority is a classification inside `ExecutionFunnel.ts`, not a separate gate.
- Completion authority: `src/core/task/tools/completion/CompletionFunnel.ts` and `CompletionSagaCoordinator.ts`. The funnel evaluates completion requirements, while the coordinator manages the transaction-split completion saga (validation command execution and prompts) after the originating permit is released.
- Completion adapters: `AttemptCompletionHandler.ts` (returns continuation outcome), `ToolExecutor.ts` (routes outcomes after terminal commit), `index.ts` (reconciles sagas during recovery), task resume, subagent envelopes, and the webview consume the single `CompletionFunnelEvent`; they must not derive independent lifecycle or completion decisions.
- Completion diagnostics remain advisory in `src/core/task/tools/completionGatePipeline.ts`; `run_finalization` is optional post-completion documentation maintenance and has no gate authority.
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
- Task/process ownership: `src/core/task/index.ts`, `ExecutionFunnel.ts`, `ExecuteCommandToolHandler.ts`, and `CommandExecutor.ts`. Shell timeout/cancellation remains owned by `CommandExecutor` beneath the funnel permit.
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
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --timeout 10000 --exit --extension ts --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs src/core/task/lifecycle/__tests__/TaskLifecycleFunnel.test.ts src/core/task/tools/execution/__tests__/ExecutionFunnel.test.ts src/core/task/tools/completion/__tests__/CompletionFunnel.test.ts
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 --exit src/core/task/tools/execution/__tests__/ExecutionFunnel.test.ts src/test/tool-executor-hooks.test.ts src/core/task/tools/siblings/__tests__/SiblingToolDependency.test.ts src/core/task/tools/siblings/__tests__/SiblingToolScheduler.test.ts src/core/task/tools/subagent/__tests__/SubagentRunner.test.ts src/core/task/tools/subagent/__tests__/executionEnvelope.test.ts
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 src/core/task/tools/subagent/__tests__/SubagentRunner.test.ts src/core/task/tools/subagent/__tests__/executionHarnessGaps.test.ts src/integrations/terminal/CommandOrchestrator.test.ts
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 src/core/task/tools/__tests__/LockAuthorityReconciliation.test.ts src/core/task/tools/subagent/__tests__/TarjanDeadlockDetector.test.ts src/core/task/tools/__tests__/TaskCompletionTerminalization.test.ts
npm run test:unit
cd webview-ui && npm test -- --run
npm run lint
npm run check:task-lifecycle-boundary
npm run ci:build
npm run roadmap:audit
npm run benchmark:meow-io
```

`mocha` must use `--no-config` for a truly focused run; `.mocharc.json` otherwise adds every `src/**/__tests__/*.ts` test.

For completion work, start with `CompletionFunnel.test.ts`, `completionFunnelHardening.test.ts`, `TaskCompletionTerminalization.test.ts`, `completionFunnelMessages.test.ts`, and `taskCompletionEvidence.test.ts`. A terminal event must always be `phase: "completed"`, expose no next action, forbid `attempt_completion`, and never regress to pending when generic resume bookkeeping is appended.

For execution work, start with `ExecutionFunnel.test.ts` and the parent/sibling/subagent parity suites. Every invocation must enter `ExecutionFunnel.execute()`, record exactly one approval decision before permit issuance, dispatch only under that linked permit, and publish one terminal event whose ordered stages explain the outcome. Composite adapters may dispatch only child intents covered by the recorded parent intent. Run `npm run check:handler-imports` to enforce the no-handler-authority boundary.

For task lifecycle work, start with `TaskLifecycleFunnel.test.ts`, then run execution, completion, and subagent integration suites. Every transition must name the exact generation and causal source. A committed cancellation request fences execution; a terminal generation is monotonic; persistence must commit record and event before publication. Run `npm run check:task-lifecycle-boundary` to prevent direct writers from returning.

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
- [Approval admission ADR](../adr/MEOW-011-execution-approval-admission.md)
- [Transactional lifecycle ADR](../adr/MEOW-012-transactional-task-lifecycle.md)
