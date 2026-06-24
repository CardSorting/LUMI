# Governed Execution Operator Runbook

Short reference for reading governed swarm receipts, recovering from failures, and deciding when retry is safe.

## Authoritative receipt

| Pointer | Meaning |
|---------|---------|
| `{swarmId}.governed.{attemptId}.json` | Immutable per-attempt receipt (source of truth for that attempt) |
| `{swarmId}.governed.history.jsonl` | Append-only attempt lineage index |
| `{swarmId}.governed.json` | Latest pointer — may lag behind a prior **sealed** attempt if a failed retry occurred |

**Rule:** If retry failed, use the last **sealed + merge passed** entry in `history.jsonl`, or call `loadAuthoritativeGovernedReceipt`. Do not trust chat status alone.

## Reading the incident console

| Incident | Meaning | Action |
|----------|---------|--------|
| **Sealed success** | Merge gate passed, receipt sealed | Safe to treat as completed |
| **In progress** | Lanes still running | Wait; do not merge |
| **Partial receipt** | Crash/interrupt before seal | Inspect claim timeline; recover stale claims |
| **Stale claim** | Ownership expired or PID/file lock stale | Run stale recovery before retry |
| **Unsafe retry** | Would supersede a sealed receipt | Link retry via `parentAttemptId`; do not overwrite sealed success |
| **Merge blocked** | Gate failed | Read violations list — fix evidence/overlap/claims |
| **Replay mismatch** | Checksum ≠ canonical state | Receipt or artifact was mutated; re-run from last good attempt |
| **Corrupted receipt** | Schema validation failed | Do not merge; inspect artifact file on disk |
| **Backend unavailable** | Durable lock layer missing | Fix DB/file workspace; retry after recovery |

## Claim timeline (what failed / what is owned)

1. **admitted** — roadmap pressure allowed the swarm
2. **acquired** — lane claim succeeded (`claimId`, fencing token, backends)
3. **released** — claim cleared through `UnifiedLockAuthority`
4. **rejected** / **stale_detected** — lock failure; check backend column (`proc+db+file+fence`)

**Still owned:** any resource with `active` status in Resource ownership. Must be `released` or recovered before retry.

## Lock backend participation

| Tag | Layer |
|-----|-------|
| `proc` | In-process registry |
| `db` | SwarmMutex (SQLite) |
| `lease` | Roadmap admission |
| `file` | Cross-process file lock |
| `fence` | Broccoli fencing token |

Partial acquisition (e.g. file lock ok, fence failed) rolls back and records **rejected** — never silent success.

## When retry is safe

Retry is safe when:

- No **active** or **stale** resource owners in claim history
- Prior sealed receipt is not superseded without explicit `parentAttemptId` chain
- Stale file/fence locks recovered (`recoverStale` on coordinator admit)

Retry is **unsafe** when:

- Orphaned/unreleased claims remain
- A sealed+merged attempt exists and the new run has unsealed DAG nodes
- Replay checksum mismatch on the authoritative attempt

## When merge must remain blocked

Merge gate blocks on:

- Parallel unsafe file overlap (DAG-ordered overlap is allowed)
- Missing transcript pointer or tool evidence on completed lanes
- Unresolved placeholders (`TODO`, `FIXME`, etc.)
- Failed lanes, unreleased claims, split-brain in claim history
- Replay checksum mismatch

## Recovering stale lanes

1. Open incident console — check **Stale claims** count
2. Re-run swarm admission (triggers `recoverStale` for `governed-lane:*`)
3. Manually clear stale files under `.broccolidb/governed/locks/` and `fencing/` only if timestamps exceed stale threshold
4. Confirm claim timeline shows **recovered** or **released**

## Replay checksum mismatch

The checksum is SHA-256 over canonical receipt fields (lanes, admission, merge result, replay artifact status).

Common causes:

- Receipt file edited after seal
- Lane receipt count ≠ replay artifact lineage
- `swarmId` / `taskId` drift between receipt and envelope

Use `explainReplayMismatch` violations in the incident console for operator-readable causes.

## Crash phases (durable receipts)

| Phase | Receipt |
|-------|---------|
| After claim, before execution | Partial; orphaned claim violation |
| During execution | Partial; lane `running` |
| After execution, before release | Unreleased claim violation |
| After release, before seal | Failed seal; may lack evidence |
| Parent before merge gate | Live `in_progress` summary only |
| Retry partial seal | Failed attempt file; authoritative pointer stays on prior sealed |

Every crash path must produce a governed receipt or recoverable stale record — never invisible success.

## Anti-recursion / architecture freeze

Governed execution invariants are **complete**. Vague improvement prompts must not expand architecture.

| Prompt pattern | Routed to |
|----------------|-----------|
| "double down", "worldclass UX", "another pass", "industry standards", "make it robust" | **audit_only** |
| "add regression test" | **test_only** |
| "update runbook" | **docs_only** |
| "adapter swap" (approved) | **thin_adapter** |
| Concrete bug + failing test | **minimal fix** |
| New lock/schema/gate without failing test | **refused** |

Classification: `classifyGovernedDirective()` in `GovernedExecutionDirective.ts`.

Freeze rule: `assertArchitectureFreeze()` — no new lock authority, receipt schema, merge gate, worker path, or parent-memory layer without a **failing test or concrete bug**.

Gate regression audit: `auditGovernedGateBehavior()` in `GovernedExecutionGateAudit.ts`.
