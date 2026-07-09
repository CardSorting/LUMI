# Troubleshooting Ledger

> **What is this?** A record of reproduced test failures, environment quirks, sandbox limits, and verified resolutions.
> **When do I use it?** When a command, build, or test fails unexpectedly to cross-reference known issues and apply verified fixes.
> **What is the source of truth?** Reproduced execution logs, stderr outputs, and validated resolution command receipts.

Last audited: 2026-07-09

## Quick Triage

| Symptom | Likely cause | First check | Fix / workaround | Verify |
|---|---|---|---|---|
| Broad mocha run fails with EPERM writing `~/.dietcode/session/roadmap-progress.jsonl` | Sandbox/home directory not writable for roadmap progress tests | Look for `RoadmapProgress.ts` stack and EPERM path | Run focused spec with `--no-config`, or rerun in an environment with writable `~/.dietcode/session` | Focused spec passes; broad suite reruns in writable env |
| `npx tsc --project tsconfig.unit-test.json` reports private member errors in e2e helpers | Unit-test tsconfig includes e2e helper sources | Errors at `src/test/e2e/utils/helpers.ts` | Use `tsconfig.json` for production typecheck unless fixing e2e/tsconfig | `npx tsc --noEmit --project tsconfig.json` passes |
| Docs say 4 providers but UI/API have 5 | Documentation drift after adding `cline-pass` | Check `src/core/api/index.ts` and `src/shared/providers/providers.json` | Update metrics/docs that mention provider count | `rg "4 providers|Wired providers"` no stale claims |
| Extension startup says `better-sqlite3` missing | VSIX/package missing native module or native dependency broken | Run `npm run doctor` | Run `npm run doctor:fix`, rebuild/repackage | `npm run doctor:ci` |
| Webview tests/build fail after core proto changes | Generated proto clients stale | Check changed files under `proto/` or `src/generated/` | Run `npm run protos`, then webview build/test | `npm run build:webview` |
| Completion keeps routing incorrectly | Eligibility logic added outside decision spine | Inspect completion handlers for local bypass logic | Move policy into `CompletionLifecycleDecisionEngine`; enforce with `CompletionActionGuard` | Completion lifecycle tests pass |
| Subagent lanes collide on read-only work | Execution mode omitted, defaulting to `mutation` | Inspect prompt tags and `LockNecessity` | Use `[execution_mode:read_only]` or correct lane config | Governed execution lock tests pass |
| Roadmap updates from lanes conflict | Lane tried to mutate workspace roadmap directly | Inspect governed receipt for direct workspace roadmap mutation | Use local roadmap events and proposed patches; coordinator commits | Roadmap projection tests pass |

## Reproduced Failures From This Pass

### Broad mocha sandbox EPERM

Command:

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha src/core/task/tools/finalization/__tests__/finalizationRunner.test.ts
```

What happened:

- Because `.mocharc.json` was still loaded, mocha ran the broader recursive suite.
- The suite reached `2172 passing`, `4 pending`, then failed two roadmap lifecycle tests.
- Both failures attempted to write `/Users/bozoegg/.dietcode/session/roadmap-progress.jsonl`.
- The sandbox denied the write with EPERM.

Confirmed non-cause:

- The new finalization tests had already passed in the visible output.
- The failure was not in the Agent Playbook finalizer.

Fix:

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha --no-config --require ts-node/register --require tsconfig-paths/register --require source-map-support/register --require ./src/test/requires.cjs src/core/task/tools/finalization/__tests__/finalizationRunner.test.ts
```

Verification:

- Focused finalization spec: `6 passing`.

### Unit-test TypeScript project includes noisy e2e helpers

Command:

```bash
npx tsc --noEmit --pretty false --project tsconfig.unit-test.json
```

What happened:

- Reported private-member access errors in `src/test/e2e/utils/helpers.ts`.

Confirmed non-cause:

- Production code typecheck was clean.

Fix/workaround:

```bash
npx tsc --noEmit --pretty false --project tsconfig.json
```

Verification:

- Main project typecheck passed.

## Validation Decision Tree

| If you touched... | Run first | Then consider |
|---|---|---|
| `src/core/task/tools/finalization/` | Focused finalization mocha spec | Main `tsc`, relevant completion tests |
| `src/core/task/tools/completion/` | Completion lifecycle/guard specs | `npm run test:unit` in writable env |
| `src/core/prompts/system-prompt/` | Prompt snapshots or targeted prompt tests | Snapshot update only after reviewing diff |
| `src/shared/tools.ts` | Tool coordinator/prompt tests | Docs for tool counts |
| `src/core/api/` or providers list | Provider handler tests | Docs/provider config updates |
| `proto/` | `npm run protos` | Webview build/test |
| `webview-ui/` | `cd webview-ui && npm run test` | `cd webview-ui && npm run build` |
| `broccolidb/` | `cd broccolidb && npm run test:guardrails` | `cd broccolidb && npm run test` |
| Docs only | `npm run docs:check-agent-links` | Branding/root README checks |

## Common Pitfalls

| Pitfall | Why it hurts | Avoidance |
|---|---|---|
| Trusting stale docs over implementation | This repo has had naming/version/provider drift | Verify with code and manifests |
| Hand-editing generated files | Regeneration can overwrite work | Edit source schema/config and rerun generator |
| Running broad mocha unintentionally | `.mocharc.json` expands the suite | Use `--no-config` for one spec |
| Treating `.wiki` as current by default | Existing wiki files contain old DietCode/Spider claims | Prefer root continuity docs until wiki is refreshed |
| Adding completion policy in handlers | Reintroduces ghost-audit/retry-loop failures | Keep policy in decision engine |
| Treating every subagent lane as mutation | Creates false lock contention | Use correct execution mode |
| Assuming root and webview tooling are identical | Webview has its own package scripts and dependencies | Run commands in the right package |

## Escalation Notes

- If a command needs network or writes outside the workspace, request approval instead of inventing a workaround.
- If a full suite fails from sandbox/home writes, preserve the failure details and run a focused validation that proves the changed surface.
- If docs and code disagree, update docs or mark drift. Do not "average" the two.
