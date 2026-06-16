# BroccoliDB: A Philosophy of Boring Substrate

*Design values grounded in the codemarie-new workspace implementation.*

---

## I. Thesis

**A complete structure is not finished until it is boring to operate.**

The `broccolidb/` package exists because agent capability outran agent accountability. The monorepo ships **MIRA** as a calm IDE companion (`readme.md`); companionship is UX. **Substrate** is responsibility — what happens to the repository when the model is wrong.

BroccoliDB v30 declares the substrate **done** not when imagination stops, but when:

- `tests/public-api-snapshot.test.ts` passes (49 export groups, zero extras)
- `COMPATIBILITY_EXCEPTIONS` is `[]` in `compatibility-purge.ts`
- `end-to-end-repair-flow.test.ts` proves audit does not touch disk
- `runtime-recovery-smoke.test.ts` proves memory survives restart
- Seven examples in `examples/` all use the same `withExampleContext` lifecycle

Boring is the compliment.

---

## II. The chain (implemented, not metaphor)

Each line maps to code you can open:

| Doctrine | Implementation |
|----------|----------------|
| Agents express intent | Capability methods on `AgentContext` |
| Capabilities validate intent | `CapabilityBase.assertStarted` + `IntentTracer` |
| Runtime governs execution | `OrchestrationRuntime` — 6 modes, 6 policies, budgets |
| Spider proves structure | `ctx.graph.spider` → internal `SpiderService` |
| StateGraph preserves truth | 16 node kinds, 11 edge kinds, `RuntimeOperator` views |
| Snapshots preserve continuity | `RuntimeSnapshotStore` + CAS blobs + `audit_events` |
| Replay reconstructs causality | `RuntimeReplayHydrator` — 5 projection modes |

```
Intent     → intent-types.ts (12 capabilities)
Validate   → CapabilityBase + GuidedError
Govern     → MODE_CONFIGS + DEFAULT_BUDGETS + ApprovalPolicyEngine
Prove      → SPI-001..010, read-only audit
Truth      → RuntimeStateGraph
Continuity → RTG-gated snapshots (schema 29.0.0)
Causality  → replay + story + timeline
```

Crossing a boundary — calling `SpiderService` directly, mutating during audit, skipping `start()` — is misuse the types, tests, and errors are designed to surface.

---

## III. Against naming as marketing

The old `broccolidb/README.md` spoke of “Sovereign Level 19” and “hyper-deterministic guardians.” v30 **removed that voice from public surfaces**. `no-experimental-public-names.test.ts` bans `sovereign`, `vitality`, `oracle`, and similar words in `public-api.ts` and `index.ts`.

Internal files may retain historical names; **integrators see boring names**:

- `RuntimeSnapshot`, not mythic persistence
- `CapabilityHealth`, not vitality
- `RepairExecutor`, not a god path
- `GuidedError`, not a cryptic stack trace

Teachability is trust. If onboarding requires folklore, the platform is not finished.

---

## IV. Proof and mutation are separable

`RepairExecutor.ts` opens with the contract:

> *RepairExecutor — the sole authorized file mutation path in BroccoliDB orchestration. Spider never mutates.*

`VerificationPipeline` closes the loop after execute: Spider audit + gate + `InvariantEngine` + diff vs baseline. Philosophy encoded as pipeline order:

1. Prove current state
2. Plan under policy
3. Mutate once, through executor
4. Prove again
5. Record graph truth
6. Refuse corrupt snapshots

SPI-006 (RealityDrift) exists because agents and disks diverge. The system assumes drift, not innocence.

---

## V. Modes and policies are ethical partitions

**Runtime modes** (`development`, `ci`, `production`, `readonly`, `recovery`, `forensic`) are not difficulty settings. They are **posture**:

| Mode | Philosophy |
|------|------------|
| `development` | Explore with `autonomous_safe` defaults — still traced |
| `ci` | Gate the pipeline; durable telemetry; strict verify |
| `production` | Human approval; tight budgets; zero verification failures allowed |
| `readonly` / `forensic` | Look without touching — investigation is not repair |
| `recovery` | Restore under `recovery_mode` — explicit second chance |

**Policies** (`human_approval_required`, `ci_gate_only`, …) refine individual plans. Autonomy is never default globally; it is **chosen by mode and policy**, then recorded in the graph.

---

## VI. Memory is operational, not decorative

Chat history is not memory. Embeddings are not memory. **Memory is what the runtime graph records:**

- Which audit ran (`Audit` node linked to `Finding`s)
- Which gate blocked (`Gate` node, `exitCode`)
- Which plan was rejected by policy (`PolicyViolation`)
- Which execution succeeded (`Execution` → `Verification`)

`RuntimeStoryBuilder` turns graph facts into narrative — `whatHappened`, `whatRemainsBlocked` — because operators think in stories, but the story is **derived**, not authored.

Snapshots refuse RTG violations because **bad memory is worse than no memory**. An orphan `HealthSnapshot` once broke integrity (RTG-001); the fix was to link truth to session, not to relax the verifier.

---

## VII. Errors teach the contract

`GuidedError` is pedagogy under stress:

```
AgentContext has not been started. Call await ctx.start() before using ctx.query.search().
Cause: Capabilities and runtime require an active lifecycle.
Fix: Wrap usage in try/finally ...
Docs: broccolidb/docs/errors.md
```

39 `AgentGitErrorCode` values exist; the public ones agents catch (`LIFECYCLE_STATE_ERROR`, `BUDGET_EXCEEDED`, `INVARIANT_VIOLATION`, …) are part of the API surface. An error without a fix is incomplete work.

---

## VIII. What the workspace refuses

Observed absences are design choices:

| Refusal | Evidence |
|---------|----------|
| Compatibility sediment | `COMPATIBILITY_EXCEPTIONS = []` |
| Public internal exports | `index.ts` → `public-api.ts` only |
| Sidecar queue DBs | `InvariantEngine` bans `telemetry_queue.db` |
| Spider mutation in audit | `end-to-end-repair-flow.test.ts` |
| Pool restart after stop | `BufferedDbPool` lifecycle; recovery uses new pool |
| Undocumented public API | `public-api-snapshot.test.ts` |

We refuse another orchestration framework because agents already plan. BroccoliDB governs **repository consequences**.

---

## IX. Relationship to MIRA and the monorepo

**MIRA** (`readme.md`): comfort-first companion in the IDE.  
**BroccoliDB** (`broccolidb/`): context engine, structural proof, governed repair, durable session truth.

They are complementary layers. Confusing them — letting companion UX substitute for substrate discipline — is how agents gain fluency without gaining accountability.

BroccoliDB is packaged (`@noorm/broccolidb`), versioned, and documented under `broccolidb/docs/` so integrators bind to a **frozen floor**, not to whatever `src/` contains this sprint.

---

## X. Measure of done

Done is falsifiable:

```bash
cd broccolidb && npm run test:guardrails && npm run test:smoke
```

Done is a new engineer running `npx tsx examples/spider-gate.ts` and understanding the platform in an afternoon.

Done is CI running `npx broccolidb spider gate` with SARIF output and a meaningful exit code.

Done is an operator running `npx broccolidb runtime story <sessionId>` after an incident and getting a causal narrative from persisted graph — not from chat logs.

When teams stop discussing BroccoliDB’s architecture and return to discussing their repositories, the substrate has succeeded.

---

## XI. Closing doctrine

Build agents that express intent through **12 capabilities**.  
Build validation that throws **GuidedError** with fixes.  
Build runtime that enforces **6 modes** and **6 policies** with real budgets.  
Build proof that **never cheats during audit**.  
Build graphs with **16 node kinds** that tell the truth.  
Build snapshots that **fail closed** on RTG violations.  
Build replay that **restores sessions** after `stop()` and new pool.

Then **stop building architecture** and start building operability.

That is the philosophy of BroccoliDB — as implemented in this workspace.

---

## See also

- [Technical Whitepaper](whitepaper.md) — measured claims and tables
- [Companion Brief](companion-brief.md) — executive numbers
- [Architecture (current)](../architecture/current.md)
- `core/orchestration/runtime/types.ts` — modes, budgets, configs
- `tests/runtime-recovery-smoke.test.ts` — continuity proof
