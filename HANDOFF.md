# Handoff Transfer

> **What is this?** A volatile transfer brief containing current implementation, documentation, validation, and workspace-state facts.
> **When do I use it?** At an agent handoff boundary before changing coordination, scheduling, or completion behavior.
> **What is the source of truth?** The current working tree and the implementation paths linked below.

Last updated: 2026-07-18

## Current Task

The production-grade lease reconciliation and execution-hardening pass is implemented and its directly affected documentation has been reconciled. The strategy now has three explicit boundaries:

1. SQLite is the sole production coordination authority; memory and filesystem records are projections.
2. Deadlock recovery is based on a versioned typed wait-for snapshot and escape-aware SCC analysis.
3. Task completion becomes terminal only through a durable lease/state CAS.

## Implementation State

| Surface | Current behavior | Primary files |
|---------|------------------|---------------|
| Authority mode | Immutable `sqlite` production mode or explicit `local_test`; no dynamic fallback | `src/core/governance/LockAuthority.ts`, `src/shared/governance/lockTypes.ts` |
| Lease allocation/release | `BEGIN IMMEDIATE`, monotonic string epoch/token, exact-tuple CAS delete | `src/core/swarm/SwarmMutexService.ts` |
| Projections | File, Broccoli, and memory validate full identity; corrupt records fail closed | `src/shared/governance/fileLock.ts`, `src/core/governance/BroccoliFencingAdapter.ts` |
| Administrative override | Separate reason-required cleaner outside runtime authority | `src/core/governance/AdministrativeLockCleaner.ts` |
| Reconciliation | Database-available snapshot required; repair/reclaim decisions are ownership checked | `src/core/governance/LockAuthority.ts` |
| Deadlock analysis | Typed wait edges, Tarjan SCC, timer/lease/owner/capacity escapes, version re-check | `src/core/task/tools/subagent/TarjanDeadlockDetector.ts`, `SubagentToolHandler.ts`, `LaneDAG.ts` |
| Terminal completion | Canonical SHA-256 decision identity and durable `task_completions` CAS | `src/core/task/tools/handlers/AttemptCompletionHandler.ts`, `src/infrastructure/db/Config.ts` |
| ACT prompt | Semantic next action, hard blockers, lane progress, completion condition only | `src/core/prompts/system-prompt/registry/PromptBuilder.ts` |

The working tree also contains earlier user changes across policy, audit, roadmap, subagent, and completion files. Preserve them; do not reset or rewrite unrelated modifications.

## Documentation Updated

Only the surfaces that describe this strategy were changed:

- `docs/architecture/sqlite-storage-and-memory-lifecycle.md`
- `DECISIONS.md` (ADR-014: SQLite Storage Retention & Memory Lifecycle Hardening)
- `docs/governed-execution-authority.md`
- `docs/governed-execution-schema.md`
- `docs/governed-execution-decisions.md`
- `docs/governed-execution-runbook.md`
- `docs/governed-subagent-execution.md`
- `docs/WORKING_WITH_SUBAGENTS.md`
- `docs/completion-lifecycle-decision-engine.md`
- `src/core/prompts/system-prompt/README.md`
- Root and `.wiki/agent/` continuity pages that describe these contracts

Provider, feature, BroccoliDB, and unrelated user documentation was intentionally left unchanged.

## Validation Evidence

| Command/suite | Result |
|---------------|--------|
| Focused coordination/liveness/completion and governed regression suite | 210 passing |
| Broad unit suite | 2,373 passing; 4 expected pending |
| `npx tsc --noEmit --pretty false` | Passed |
| `npm run lint` | Passed, including protobuf lint and handler-import checks |
| `git diff --check` | Passed before the documentation pass |
| `npm run rebuild:electron:better-sqlite3` | Passed; Electron-native module restored after Node DB tests |
| Agent-doc links and branding | Passed |
| Docs README and root README links | Passed |
| Root README metadata, metrics, and links | Passed after updating release identity to `9.0.0` |
| Aggregate docs check | README checks pass; blocked only by the existing Mintlify broken-link backlog |
| Mintlify broken links | Reports 145 pre-existing links in 37 unrelated files; none of the changed governed-execution docs were listed |

Use `--no-config` for focused Mocha commands. `.mocharc.json` otherwise adds the entire recursive test suite. Do not run broad suites concurrently because governed tests share process-global authority state.

## Durable Constraints

- Never fall back from SQLite authority to memory/filesystem state in production.
- Never compare fencing identity through JavaScript `number`.
- Never unlink a malformed projection automatically.
- Never expose administrative force cleanup through `LockAuthority` or normal orchestration.
- Never classify a cycle as deadlock until all typed escape transitions are checked.
- Never apply scheduler recovery after either snapshot version changes.
- Never publish terminal in-memory state before the durable completion transaction commits.
- Keep the Electron `better-sqlite3` build restored after Node-native database testing.

## Recommended Next Actions

1. If implementation changes further, rerun the three focused hardening suites before broad validation.
2. Resolve the unrelated Mintlify broken-link backlog only in a separately scoped documentation pass.
3. Commit only after separating this pass from any unrelated pre-existing workspace changes according to maintainer preference.

## Final Review Checklist

- [x] Production authority and failure behavior documented.
- [x] Exact lease/projection identity and precision rules documented.
- [x] Normal reconciliation and administrative override separated.
- [x] Typed deadlock graph and snapshot consistency documented.
- [x] Durable completion identity, CAS, idempotency, and conflict behavior documented.
- [x] ACT execution-state prompt contract documented.
- [x] Agent playbook, memory, findings, troubleshooting, pitfalls, patterns, and index updated.
- [x] Documentation/link checks rerun after this documentation pass; unrelated baseline failures recorded above.
