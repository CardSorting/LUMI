# Agent Playbook

> **What is this?** A high-velocity, current-state operating brief for autonomous agents in this workspace.
> **When do I use it?** At task start to understand the active developer landscape, blockers, and orientation paths.
> **What is the source of truth?** The live workspace layout, manifests, package files, and the active task requirements.

Last audited: 2026-07-18

## Current Status

| Area | State | Evidence |
|---|---|---|
| Product | LUMI VS Code extension monorepo | `package.json` name `lumi-vscode`, version `5.0.0` |
| Workspaces | Root package plus `broccolidb` | `package.json` workspaces: `.`, `broccolidb` |
| UI | React/Vite webview | `webview-ui/package.json` |
| Substrate | BroccoliDB package | `broccolidb/package.json` name `@noorm/broccolidb` |
| Tools | 64 typed tool enum values | `src/shared/tools.ts` |
| Providers | 6 provider keys in code/UI | `src/core/api/index.ts`, `src/shared/providers/providers.json` |
| Active pass | Lease reconciliation, scheduler liveness, and durable completion hardening | Current working tree |

## What Is Happening Right Now

The active work now includes production authority and terminalization hardening:

- `src/core/governance/LockAuthority.ts` fixes coordination mode at startup and uses SQLite as the sole production lease authority.
- `src/core/swarm/SwarmMutexService.ts` allocates precision-safe lease epochs/fencing tokens and commits exact-tuple lease changes under `BEGIN IMMEDIATE`.
- `src/core/governance/AdministrativeLockCleaner.ts` isolates explicit, logged ownership overrides from normal orchestration.
- `src/core/task/tools/subagent/TarjanDeadlockDetector.ts` detects only unresolvable SCCs from a versioned scheduler snapshot.
- `src/core/task/tools/handlers/AttemptCompletionHandler.ts` persists terminal results through a lease/state CAS in `task_completions`.
- `src/integrations/terminal/CommandExecutor.ts` implements scoped command cancellation using `ownerId` to cancel processes concurrently and independently.
- `src/core/task/tools/handlers/SubagentToolHandler.ts` improves subagent concurrency controls by counting active execution slots (`running.size`) rather than yielded lifecycle states, and prefetches parent context asynchronously off the critical path.
- `src/core/task/tools/subagent/ResumeSwarmFromArtifact.ts` ensures resume safety by requiring a valid, sealed governed lane receipt and matching checksum before reusing previous agent results.
- `src/core/task/tools/subagent/SubagentRunner.ts` implements repetition detection to break tool repetition loops with self-correction nudges and signal toxic hotspots.
- `src/core/task/tools/subagent/SubagentTranscriptRecorder.ts` writes JSONL logs atomically using temporary files to prevent corruption, and supports deferred write-behind scheduling.

## First 10 Minutes For A New Agent

1. Run `git status --short` and separate user changes from your own.
2. Read this file, [HANDOFF.md](HANDOFF.md), [TROUBLESHOOTING.md](TROUBLESHOOTING.md), and [WIKI.md](WIKI.md).
3. For architecture, verify against `docs/architecture/current.md`, `docs/PROJECT_MAP.md`, and `docs/AGENT_STACK.md`.
4. For active agent/finalization work, inspect `src/core/task/tools/finalization/` and `src/core/prompts/system-prompt/components/integrity_wiki.ts`.
5. For coordination/completion work, inspect `LockAuthority.ts`, `SwarmMutexService.ts`, `TarjanDeadlockDetector.ts`, and `AttemptCompletionHandler.ts` before changing a projection or retry path.
6. Pick the smallest validation command that matches the touched surface.

## Active Priorities

| Priority | Why it matters | Next action |
|---|---|---|
| Keep playbook generation accurate | It is now part of finalization evidence | Preserve workspace-evidence based generation and tests |
| Keep Workspace Intelligence first-class | It now persists typed cognitive models during finalization | Extend `src/core/workspace-intelligence/` instead of scattering continuity logic |
| Separate stable docs from handoff state | Prevents stale wiki sprawl | Put durable architecture in `WIKI.md`, temporary state in `HANDOFF.md` |
| Prevent doc drift regressions | Provider/version metrics drifted and were corrected in this pass | Keep metrics tied to manifests and code |
| Keep completion/finalization lifecycle deterministic | Recent architecture centers on action contracts | Do not bypass `CompletionLifecycleDecisionEngine` or `CompletionActionGuard` |
| Preserve one production coordination authority | Database outage must not create split-brain fallback | Keep `sqlite` fail-closed and `local_test` explicit |
| Keep terminalization restart-safe | In-memory completion state is not durable | Commit `task_completions` only through lease/state CAS |

## Current Blockers And Friction

| Symptom | Current understanding | Workaround |
|---|---|---|
| Broad `npx mocha ...` can fail in sandbox | Roadmap tests try to write `/Users/bozoegg/.dietcode/session/roadmap-progress.jsonl` and hit EPERM | Use focused `--no-config` mocha for changed specs, or run with an approved writable home/session setup |
| `tsconfig.unit-test.json` typecheck includes e2e helpers | Existing private member errors in `src/test/e2e/utils/helpers.ts` | Use `npx tsc --noEmit --project tsconfig.json` for production code unless fixing unit tsconfig |
| ROADMAP.md contains stale bootstrap/generated text | It disagrees with current package/provider state | Prefer implementation and maintained docs until roadmap is refreshed |
| Docs metrics drift can return | Provider/version metrics have drifted before | Use `src/core/api/index.ts`, `providers.json`, and `package.json` as sources of truth |

## Recently Changed Files

| File | Why it changed |
|---|---|
| `src/integrations/terminal/CommandExecutor.ts` | Scoped terminal command cancellation via `ownerId`. |
| `src/core/task/tools/handlers/SubagentToolHandler.ts` | Subagent queue admission concurrency fixes and async prefetching. |
| `src/core/task/tools/subagent/ResumeSwarmFromArtifact.ts` | Resuming swarms requires valid governed receipt integrity. |
| `src/core/task/tools/subagent/SubagentRunner.ts` | Subagent tool repetition detection and durable transcript checks. |
| `src/core/task/tools/subagent/SubagentTranscriptRecorder.ts` | Atomic, buffered transcript persistence to disk. |
| `src/core/governance/LockAuthority.ts` | SQLite authority ordering, exact release, and reconciliation. |
| `src/core/governance/AdministrativeLockCleaner.ts` | Isolated manual/panic cleanup with an override reason. |
| `src/core/swarm/SwarmMutexService.ts` | Transactional lease generation and precision-safe fencing. |
| `src/core/task/tools/subagent/TarjanDeadlockDetector.ts` | Typed wait-for graph and escape-aware SCC detection. |
| `src/core/task/tools/handlers/AttemptCompletionHandler.ts` | Canonical decision digest and durable terminal CAS. |
| `src/core/task/tools/subagent/__tests__/executionHarnessGaps.test.ts` | Tests for transcript durability, retry, integrity, and replay contract. |

## Files To Avoid Touching Casually

| Path | Why | Safer path |
|---|---|---|
| `dist/`, `out/`, `webview-ui/build/`, `src/generated/` | Generated/build output | Edit sources and run generation/build scripts |
| `package-lock.json`, `webview-ui/package-lock.json`, `broccolidb/package-lock.json` | Lockfiles should follow dependency changes | Let package manager update them |
| `proto/` and generated proto outputs | Protocol changes ripple across host bridge and webview | Edit schema, then run `npm run protos` |
| `ROADMAP.md` | Steering surface has stale content and governance hooks | Update only with evidence and roadmap intent |
| `broccolidb/` | Separate substrate package with its own tests/docs | Use BroccoliDB docs and package scripts |
| `.wiki/` | Now partly managed by finalization | Preserve human content; managed generated sections should be replaced, not duplicated |

## Do / Do Not

| Do | Do not |
|---|---|
| Mirror existing module boundaries | Invent new architecture directories for one task |
| Use `HostProvider` for VS Code I/O | Import `vscode` directly in core code |
| Validate with the narrowest relevant command first | Run full CI as a reflex when a focused test proves the touched path |
| Update docs when code changes alter workflow or contracts | Let metrics, provider counts, or command guidance drift |
| Treat SQLite as production coordination authority | Infer ownership from memory, PID, mtime, or a projection file |
| Keep epochs/tokens as decimal strings or `bigint` | Convert fencing identity through JavaScript `number` |
| Record reproduced failures in [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Record guesses as troubleshooting facts |
| Keep LUMI session docs separate from BroccoliDB substrate docs | Merge the narratives into one vague agent story |

## Validation Command Menu

| Scope | Command |
|---|---|
| Production TypeScript | `npx tsc --noEmit --pretty false --project tsconfig.json` |
| Focused Subagent/Executor tests | `TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 src/core/task/tools/subagent/__tests__/SubagentRunner.test.ts src/core/task/tools/subagent/__tests__/executionHarnessGaps.test.ts src/integrations/terminal/CommandOrchestrator.test.ts` |
| Coordination/liveness/completion tests | `npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs --timeout 10000 src/core/task/tools/__tests__/LockAuthorityReconciliation.test.ts src/core/task/tools/subagent/__tests__/TarjanDeadlockDetector.test.ts src/core/task/tools/__tests__/TaskCompletionTerminalization.test.ts` |
| Touched file style | `npx biome check <files> --files-ignore-unknown=true --diagnostic-level=error` |
| Docs links | `npm run docs:check-agent-links` |
| Docs branding | `npm run docs:check-agent-branding` |
| Webview | `cd webview-ui && npm run test` or `cd webview-ui && npm run build` |
| BroccoliDB guardrails | `cd broccolidb && npm run test:guardrails` |
| Full quality gate | `npm run ci:check-all` |

## Active Assumptions

- `package.json` and implementation are more trustworthy than stale generated docs.
- The finalization lane owns `.wiki` writes for product behavior; humans/agents may still maintain root docs directly when explicitly asked.
- Workspace Intelligence currently persists at finalization time; earlier lifecycle observation remains a design item.
- `cline-pass` is a real active provider key because both `buildApiHandler` and `providers.json` list it.
- The root docs created in this pass are workspace operating docs, not Mintlify user docs.
- Agent playbook generation should preserve human-authored wiki content by updating managed sections.
- Production coordination records use `authorityMode: sqlite`; `local_test` records never migrate into production authority.
- Completion is terminal only after the durable `task_completions` CAS commits.

## Known Unknowns

| Unknown | How to resolve |
|---|---|
| Whether `ROADMAP.md` should be rebuilt or manually repaired | Run a dedicated roadmap checkpoint/audit pass |
| Whether provider counts drift again later | Search `4 providers`, `Wired providers`, `Provider key` and reconcile against code |
| Whether broad unit tests pass outside sandbox | Re-run with write access to `~/.dietcode/session` or override storage path if supported |
| Whether `.wiki/00-forensics.md` still reflects current Spider health | Run current Spider/roadmap diagnostics and update with dated evidence |
| How much task-start/tool-execution telemetry Workspace Intelligence should record | Design lifecycle hooks and storage/privacy limits before adding continuous writes |

## Recommended Next Steps

1. Keep this root playbook and `.wiki/agent/playbook.md` aligned.
2. Keep provider/version metrics synchronized when package or provider metadata changes.
3. Refresh `ROADMAP.md` with real current priorities.
4. Add a docs check for root continuity files if they become part of the release contract.
5. Extend Workspace Intelligence beyond finalization only after deciding storage volume, privacy, and lifecycle hook boundaries.
