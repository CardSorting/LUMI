# Agent Fast Orientation

Last validated: 2026-07-12

## Current Snapshot

- Task admission and agent loop: `src/core/task/index.ts`.
- Tool dispatch and execution policy: `src/core/task/ToolExecutor.ts` and `src/core/task/tools/`.
- Workspace-local query authority: `src/core/task/tools/executionAuthority.ts`.
- Completion diagnostics: `src/core/task/tools/completionGatePipeline.ts`.
- Roadmap lifecycle and advisory journal: `src/services/roadmap/`.
- Durable audit evidence: `src/shared/audit/completionAudit.ts` and `src/infrastructure/ai/Orchestrator.ts`.
- Task latency trace: `src/core/task/latency/TaskLatencyTracker.ts`.
- Sibling dependency, bounded scheduling, and invocation capture: `src/core/task/tools/siblings/`.
- Query singleflight/generation evidence: `src/core/task/tools/io/IoRequestCoalescer.ts`.
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
npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 <test-files>
npm run test:unit
npm run lint
npm run roadmap:audit
```

`mocha` must use `--no-config` for a truly focused run; `.mocharc.json` otherwise adds every `src/**/__tests__/*.ts` test.

For Task-level focused tests, also require `./src/test/requires.cjs` so the VS Code shim is installed.

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
- [ADR index](../adr/README.md)
- [Migration report](../meow-migration.md)
