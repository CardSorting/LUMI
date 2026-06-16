# BroccoliDB Technical Whitepaper

**Version 30 — Stable Operational Substrate**

*A complete structure is not finished until it is boring to operate.*

**Package:** `@noorm/broccolidb` · **Graph schema:** `29.0.0` · **Repository:** `broccolidb/` in the codemarie-new monorepo

---

## Abstract

BroccoliDB is an agent-facing platform for repository work: knowledge graph search, structural proof, governed repair, and durable operational memory. It ships as the `@noorm/broccolidb` npm package with a **frozen public API** (`core/public-api.ts`, 49 export groups enforced by `tests/public-api-snapshot.test.ts`), a **stdio MCP server** (`npx broccolidb serve`, 67 registered tools including 9 Spider forensic tools), and a **CLI** for health, structural gates, and runtime operator views.

The system sits between autonomous agents and the repositories they modify. It enforces separation between **intent** (capability calls), **validation** (lifecycle + policy), **proof** (Spider read-only audit), and **execution** (`RepairExecutor` — the sole authorized mutation path in orchestration). Operational truth lives in a **RuntimeStateGraph** (16 node kinds, 11 edge kinds), persisted through integrity-checked **snapshots** (RTG-001–008), and reloaded on restart via `restorePersistedSessions()`.

This whitepaper is grounded in the implementation as it exists in the workspace: file paths, types, budgets, tests, and guardrails cited here are verifiable in the tree.

---

## 1. The problem

### 1.1 Agents without substrate discipline

Coding agents in this monorepo (and elsewhere) combine LLMs with file tools, terminals, and MCP servers. The parent project’s **MIRA** extension (`readme.md`) describes a “calm coding companion” — but companion UX does not substitute for repository substrate discipline. Without a governed layer, teams cannot answer after an agent run:

| Forensic question | Without substrate | With BroccoliDB |
|-------------------|-------------------|-----------------|
| What was attempted? | Scattered logs | `RuntimeStateGraph` + `IntentTracer` |
| What blocked progress? | Unknown | `ctx.runtime.blockers()` |
| What changed on disk? | Git diff only | `RepairExecutor` trace + verification diff |
| Was structure re-proven? | Maybe a linter ran | Spider post-execute audit in `VerificationPipeline` |
| Can we reconstruct tomorrow? | No | `snapshot` → CAS + `audit_events`; `replay` after restart |

### 1.2 What the workspace implements

The `broccolidb/` package is not a greenfield sketch. As of v30 it includes:

| Artifact | Count / location |
|----------|------------------|
| Test files | **69** under `broccolidb/tests/` |
| Public API export groups | **49** (allowlist in `public-api-snapshot.test.ts`) |
| Capability surfaces | **12** (`intent-types.ts`: storage, telemetry, recovery, audit, coordination, query, snapshots, graph, reasoning, tasks, scratchpad, mailbox) |
| Golden-path examples | **7** scripts + `_bootstrap.ts` under `examples/` |
| v30 guardrail tests | 7 dedicated (`public-api-snapshot`, `error-message`, `no-experimental-public-names`, `cli-smoke`, `docs-link-check`, `examples-smoke`, `runtime-recovery-smoke`) |
| Typed error codes | **39** `AgentGitErrorCode` values in `core/errors.ts` |
| MCP tools (total) | **67** registrations in `core/mcp.ts` |
| Spider MCP tools | **9** (`spider-mcp-tools.ts`) |

---

## 2. Design principles (v30)

These are enforced in code and CI, not merely documented:

1. **Frozen public surface** — `index.ts` re-exports only `core/public-api.ts`. Orchestration internals (`MutationPlanner`, `RuntimeGraphStore`, …) are importable via deep paths for maintainers only.

2. **Capabilities, not services** — `AgentContext` exposes getters (`ctx.graph`, `ctx.runtime`, …). `SpiderService` is internal; agents use `ctx.graph.spider`.

3. **Proof before mutation** — `end-to-end-repair-flow.test.ts` asserts file content unchanged after `audit`. `RepairExecutor.ts` header: *“Spider never mutates.”*

4. **One mutation path** — `RepairExecutor.execute()` applies `MutationPlan` steps; snapshots taken before writes.

5. **Empty compatibility sediment** — `COMPATIBILITY_EXCEPTIONS` in `compatibility-purge.ts` is an **empty array**; guardrails require any future exception to carry `deletionDate`.

6. **Integrity-gated snapshots** — `RuntimeGraphStore.snapshot()` refuses persistence when `RuntimeIntegrityVerifier` reports violations.

7. **Actionable errors** — `GuidedError` extends `LifecycleStateError` with cause, fix, command, and `broccolidb/docs/errors.md` link (`error-guidance.ts`).

---

## 3. Architectural model

### 3.1 Layered flow (implemented)

```
Agent
  → AgentContext (lifecycle: new → starting → started → stopping → stopped)
    → 12 Capabilities (CapabilityBase: assertStarted + IntentTracer)
      → OrchestrationRuntime
          → RuntimeStateGraph (16 node kinds)
          → RuntimeGraphStore → RuntimeSnapshotStore (CAS via StorageService)
      → SpiderService (internal) ← ctx.graph.spider only
```

**LifecycleRegistry** start order: `db` → `storage` → `cleanup` → `mutex` → `lsp` → `coordinator` → `orchestration`. Stop reverses this. `BufferedDbPool` cannot restart after `stop()` — recovery tests use a **new pool** on the same `broccolidb.db` path.

### 3.2 AgentContext

Defined in `core/agent-context.ts`. Registers:

- **Capabilities:** storage, telemetry, recovery, audit, coordination, query, snapshots, graph, reasoning, tasks, scratchpad, mailbox
- **Runtime:** `OrchestrationRuntime` with `db`, `storage`, `userId` deps for durable memory
- **Health:** `ctx.health()` aggregates lifecycle registry + per-capability `CapabilityHealth` + optional deep invariant audit

`assertOperational()` throws `GuidedError` — verified by `lifecycle.test.ts` and `examples/lifecycle-error.ts`.

### 3.3 Intent tracing

`IntentTracer` records per-capability operations with priority (`low` | `normal` | `high` | `critical`), durability (`ephemeral` | `buffered` | `durable`), and optional durable persistence via `enableDurableIntentTraces()`. Health exposes `perCapabilityIntentCounts` — the substrate’s answer to “what did the agent actually call?”

### 3.4 Orchestration pipeline

Components in `core/orchestration/`:

| Component | Role |
|-----------|------|
| `OrchestrationRuntime` | Session lifecycle, operator API |
| `MutationPlanner` | Audit → `MutationPlan` |
| `ApprovalPolicyEngine` | Policy decisions; `PolicyBlockedError` |
| `RepairExecutor` | Sole file mutation path |
| `VerificationPipeline` | Post-execute Spider audit + gate + invariants + diff |
| `RollbackCoordinator` | File snapshot restore |
| `ExecutionTrace` | Structured trace events |
| `RuntimeScheduler` / `SessionQueue` | Governed execution queue |
| `ExecutionBudgetManager` | Budget enforcement; `RuntimeBudgetExceededError` |
| `RuntimePolicyEngine` | Mode-aware policy; `RuntimePolicyViolationError` |
| `ConcurrencyGovernor` | Mode `maxConcurrentExecutions` |
| `SessionJournal` | 11 journal kinds (`session_started` … `policy_violation`) |
| `RuntimeEventBus` | 12 typed runtime event variants |
| `ReplayRecorder` | Legacy replay projection |

**Session statuses** (`ExecutionSessionStatus`): `running`, `blocked`, `awaiting_approval`, `verifying`, `completed`, `failed`, `rolled_back`.

**Typical flow** (from `examples/repair-flow.ts` and `end-to-end-repair-flow.test.ts`):

```
beginSession → graph.spider.audit → recordAudit → graph.spider.gate → recordGate
  → planRepairs → preview → [execute] → verify → snapshot
```

### 3.5 Runtime modes and policies (actual types)

**Runtime modes** (`RuntimeMode` in `orchestration/runtime/types.ts`) — set via `ctx.runtime.setMode()`:

| Mode | Default policy | Max directives | Max files | Executes allowed |
|------|----------------|----------------|-----------|------------------|
| `development` | `autonomous_safe` | 30 | 20 | Yes (2 concurrent) |
| `ci` | `ci_gate_only` | 15 | 10 | Safe-only (1 concurrent) |
| `production` | `human_approval_required` | 10 | 5 | Safe-only (1 concurrent) |
| `readonly` | `readonly` | 0 | 0 | No |
| `recovery` | `recovery_mode` | 20 | 15 | Yes (1 concurrent) |
| `forensic` | `readonly` | 0 | 0 | No |

**Approval policies** (`ApprovalPolicy`) — passed to `planRepairs`, `preview`, `execute`:

`readonly` · `autonomous_safe` · `human_approval_required` · `ci_gate_only` · `recovery_mode` · `production_locked`

Mode selects defaults; policy governs individual plan execution. `production` mode + `human_approval_required` is the human-in-the-loop posture. `development` + `autonomous_safe` is the local agent default.

**Default budgets** (`DEFAULT_BUDGETS`) also cap `maxDurationMs`, `maxVerificationFailures`, and `maxRollbackAttempts` per mode — e.g. production allows **zero** verification failures; development allows **3**.

### 3.6 RuntimeStateGraph

**Node kinds** (16): `Intent`, `Session`, `Audit`, `Finding`, `RepairDirective`, `MutationPlan`, `ApprovalDecision`, `Execution`, `Verification`, `Rollback`, `Replay`, `RuntimeEvent`, `HealthSnapshot`, `BudgetViolation`, `PolicyViolation`, `Gate`.

**Edge kinds** (11): `created`, `triggered`, `blocked_by`, `approved_by`, `executed_by`, `verified_by`, `rolled_back_by`, `introduced`, `resolved`, `failed_due_to`, `replayed_from`, `belongs_to_session`.

**Operator projections** (`RuntimeOperator`): `state`, `timeline`, `explain`, `nextActions`, `blockers`, `openLoops`, `causalView`, `diffView`, `export` (json | markdown | sarif).

**Story** (`RuntimeStoryBuilder`): `narrative`, `whatHappened`, `why`, `whatChanged`, `whatFailed`, `whatRecovered`, `whatRemainsBlocked` — verified by `runtime-story.test.ts`.

### 3.7 Durable memory store

`core/orchestration/state/store/`:

| Class | Function |
|-------|----------|
| `RuntimeGraphStore` | Orchestrates snapshot, flush, integrity, recovery |
| `RuntimeSnapshotStore` | Metadata + CAS blob refs; `audit_events` rows (`type: runtime_snapshot`) |
| `RuntimeGraphSerializer` | Serialize/deserialize; `graphHash` |
| `RuntimeIntegrityVerifier` | RTG-001–008 |
| `RuntimeReplayHydrator` | 5 replay modes: `timeline`, `forensic`, `verification`, `causal`, `ci` |
| `RuntimeCompactor` | Graph compaction with replayability guarantee |
| `RuntimeMigrationEngine` | Schema migration (`RUNTIME_GRAPH_SCHEMA_VERSION = '29.0.0'`) |
| `RuntimeIndex` | Cross-session index |
| `RuntimeStoryBuilder` | Human narrative |

**Persistence path:** graph payload → `StorageService.writeBlob()` (sharded CAS under `.broccolidb/storage/blobs/`); snapshot metadata → `BufferedDbPool` `audit_events`.

**Recovery** (`runtime-recovery-smoke.test.ts`): snapshot → stop → new pool + new `AgentContext` → `restorePersistedSessions()` → `replay` + `story` succeed.

**Integrity block example:** `recordHealthSnapshot` must `linkSession` — orphaned `HealthSnapshot` nodes triggered RTG-001 until fixed; snapshots now refuse corrupt graphs.

---

## 4. Spider: structural forensic engine

Implementation: `core/policy/spider/` (40+ modules), façade: `ctx.graph.spider` via `GraphCapability`.

### 4.1 SPI diagnostics (implemented)

| ID | Name |
|----|------|
| SPI-001 | SymbolicContractBreakage |
| SPI-002 | TypeSoundnessFailure |
| SPI-003 | ArchitecturalVolcano |
| SPI-004 | StructuralLoop |
| SPI-005 | LayerViolation |
| SPI-006 | RealityDrift |
| SPI-007 | SemanticIdentityMismatch |
| SPI-008 | RepairDirectiveUnsafe |
| SPI-009 | CompilerUnavailable |
| SPI-010 | GraphStaleness |

### 4.2 Evidence model

From `report-types.ts`:

- **SpiderFinding** — evidence array, severity, diagnosticId, optional `findingId`
- **SemanticFootprint** — `astNormalizedHash`, `signatureHash`, `currentLocation`, `moveConfidence`
- **RepairDirective** — `directiveId`, `type`, `targetFile`, `riskLevel`, `verificationCommand`
- **Disk parity** — explicit `driftStatus`; SPI-006 triggers resync before mutation (`RepairExecutor` calls `spider.resync`)

### 4.3 MCP Spider tools (9)

Registered names in `spider-mcp-tools.ts`:

`spider_get_catalog` · `spider_validate_check_request` · `spider_validate_failure` · `spider_run_scenario` · `spider_export_schemas` · `spider_forensic_check` · `spider_forensic_pipeline` · `spider_restore_wire` · `spider_export_ci_artifacts`

Output interchange: JSON check response, NDJSON streams, SARIF (`AgentFormats.ts`), GitHub Check Run annotations, compact digest (`AgentToolkit.formatCheckDigest`).

### 4.4 Verification integration

`VerificationPipeline.verify()` after execute:

1. Spider audit (`changed-files`, types + directives)
2. Spider gate
3. `InvariantEngine.auditInvariants()`
4. `diffSinceLast` — introduced vs resolved findings vs baseline

This is the substrate’s closed loop: **mutate → prove → compare**.

---

## 5. Infrastructure substrate

### 5.1 BufferedDbPool

`infrastructure/db/BufferedDbPool.ts` — async SQLite with write buffering, lifecycle states, flush intervals. Single `broccolidb.db` per workspace (CLI `init` adds to `.gitignore`).

### 5.2 Workspace and repository

`Workspace` scopes operations per `userId` / `workspaceId`, resolves `Repository` for Git-backed file graph. Knowledge graph nodes live in SQLite `knowledge` table (CLI `status` reports node/edge/hub counts).

### 5.3 InvariantEngine

`core/agent-context/InvariantEngine.ts` scans workspace for **banned files** (e.g. `telemetry_queue.db`, legacy `SqliteQueue.ts`, `PasteStore.ts`) and banned symbols in source — surfaced via `ctx.health({ deep: true })` and verification.

### 5.4 Storage CAS

`StorageService` — content-addressed blobs, SHA-256 sharding, integrity errors as `StorageIntegrityError` (`STORAGE_CORRUPT`).

---

## 6. Public API and guardrails (v30)

**Stable exports:** `AgentContext`, `OrchestrationRuntime`, `Workspace`, `Connection`, `GuidedError`, policy errors, capability/intent/runtime types — see `public-api.ts`.

**Guardrail tests (must pass in CI):**

| Test | Enforces |
|------|----------|
| `public-api-snapshot.test.ts` | Export allowlist |
| `no-experimental-public-names.test.ts` | No sovereign/vitality/oracle in public exports |
| `error-message.test.ts` | GuidedError shape |
| `cli-smoke.test.ts` | health/spider/runtime commands exist |
| `docs-link-check.test.ts` | 13 broccolidb doc files link cleanly |
| `examples-smoke.test.ts` | 7 examples execute |
| `runtime-recovery-smoke.test.ts` | Snapshot survives restart |

**Orchestration regression suite** (representative): `execution-session`, `mutation-planner`, `approval-policy`, `verification-pipeline`, `rollback-coordinator`, `orchestration-guardrails`, `end-to-end-repair-flow`, `runtime-state-graph`, `runtime-graph-store`, `deterministic-replay`, `runtime-integrity`, `runtime-replay-hydration`.

---

## 7. Operations

### 7.1 CLI (`broccolidb/cli/`)

| Command | Implementation |
|---------|----------------|
| `init` | Git index + `broccolidb.db` + optional Claude Desktop MCP config |
| `health` | `commands/health.ts` — `ctx.health()` + `getMemoryHealth()` |
| `spider gate` | `commands/spider.ts` — audit + gate in runtime session |
| `spider compact` | `check` + `formatCheckDigest` |
| `runtime state\|replay\|story\|snapshot` | `commands/runtime.ts` |
| `serve` | `BroccoliDBMCP` stdio server |
| `status` | Legacy graph density view |

Formats: `--format human|compact|json|sarif`.

### 7.2 Integration contract

```typescript
await ctx.start();
try {
  const session = await ctx.runtime.beginSession({ taskId: 'work' });
  const audit = await ctx.graph.spider.audit({ scope: 'all' });
  ctx.runtime.recordAudit(session.sessionId, audit);
  await ctx.runtime.snapshot(session.sessionId);
} finally {
  await ctx.flush();
  await ctx.stop();
}
```

---

## 8. Position in the codemarie-new workspace

| Component | Path | Relationship |
|-----------|------|--------------|
| BroccoliDB package | `broccolidb/` | Agent substrate (this document) |
| MIRA extension | `readme.md`, `src/` | IDE companion; consumes context, not a substitute for substrate |
| Extended API docs | `docs/api/` | Spider ergonomics, runtime snapshots, replay |
| Architecture history | `docs/history/architecture/` | v26–v29 milestone archaeology |

BroccoliDB is deliberately **packaged and versioned** (`@noorm/broccolidb`) so agents, CLI, and MCP integrate against a frozen surface — not against whatever happens to exist in `src/` this week.

---

## 9. Post-v30 posture

v30 **stops architecture expansion**. The substrate is operable:

- Boring names in public docs (no “sovereign runtime” in export surfaces)
- Teachable examples that all share `_bootstrap.ts` lifecycle
- Papers, API stability policy, and migration guide in `broccolidb/docs/`

Future work: hardening, performance, interchange formats — not new hidden subsystems.

---

## 10. Conclusion

BroccoliDB in this workspace is a **finished operational floor**: 12 capabilities, 6 runtime modes, 6 approval policies, 16 graph node kinds, 8 integrity diagnostics, 9 Spider MCP tools, 69 tests, and 7 golden examples — all pointing at one doctrine:

*Agents express intent. Capabilities validate. Runtime governs. Spider proves. StateGraph preserves truth. Snapshots preserve continuity. Replay reconstructs causality.*

The whitepaper’s claims are falsifiable: run `npm run test:guardrails` and `npm run test:smoke` in `broccolidb/`.

---

## References

- [Public API](../public-api.md) · [Architecture](../architecture/current.md)
- [API Stability](../../API_STABILITY.md) · [Examples](../../examples/)
- [Spider ergonomics](../../../docs/api/spider-agent-ergonomics.md)
- [Runtime integrity](../../../docs/api/runtime-integrity.md)
- `core/public-api.ts` · `core/orchestration/runtime/types.ts` · `tests/`

**License:** MIT
