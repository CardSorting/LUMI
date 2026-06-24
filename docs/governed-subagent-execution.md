# Governed Subagent Execution

LUMI as a collision-safe, replayable, distributed execution harness for agents. The parent is **coordinator, reviewer, and receipt presenter** — not a memory sink.

## Four invariants

### 1. One authority for ownership

All mutation claims flow through `LockAuthority` (`src/core/governance/LockAuthority.ts`):

| Implementation | Use |
|----------------|-----|
| `UnifiedLockAuthority` | Production: in-process registry + `SwarmMutexService` + roadmap leases + cross-process file locks |
| `InMemoryLockAuthority` | Unit tests / DB-unavailable dev |

Fails closed on collision, split-brain, stale, unavailable, or ambiguous lock state. `mem_claim` uses the same authority.

### 2. One durable truth surface

Per-lane artifacts (nothing important in parent chat memory):

| Artifact | Contents |
|----------|----------|
| `{swarmId}.json` | Swarm execution envelope |
| `{agentId}.transcript.jsonl` | Append-only event log |
| `{swarmId}.governed.{attemptId}.json` | Governed receipt (append-only retry chain) |
| `{swarmId}.governed.history.jsonl` | Attempt lineage index |

Receipt fields: admission, lane DAG, claim history, lane receipts, merge gate, replay checksum, seal status.

### 3. One merge gate

`MergeGate.runMergeGate()` blocks success until:

- No overlapping `touchedFiles`
- No missing evidence / transcript on completed lanes
- No unresolved placeholders
- No failed or collision-rejected lanes
- No orphaned claims
- No stale leases
- No blocked/running DAG nodes at seal time
- Replay integrity valid

Swarm status is forced to `failed` when the gate does not pass.

### 4. One operator surface

`GovernedReceiptPanel` in `SubagentStatusRow` renders:

- Admission, merge gate, seal, integrity
- Per-lane status + DAG state
- Violations (no transcript spelunking required)

Data flows via `DietCodeSaySubagentStatus.governedReceipt`.

## Architecture

```
Parent (coordinator)
  ├─ LockAuthority.acquire()     → unified lease + mutex + in-process fence
  ├─ LaneDAG                     → ready / blocked / running / sealed / failed
  ├─ SubagentRunner / worker_cli → bounded lane execution
  ├─ MergeGate                   → audit-first reconciliation
  └─ sealReceipt()               → execution.replay/v1 + governed receipt
```

## Lane model

| Concept | Value |
|---------|-------|
| Lane ID | `swarm-lane:{swarmId}:{index}` |
| Mutex resource | `governed-lane:{swarmId}:{index}` |
| Roadmap lease | `swarm-lane-{swarmId}-{index}` |
| DAG deps | Optional `Map<index, dependsOn[]>` |

## Process workers

`broccolidb/worker_cli.ts` uses the same `src/shared/governance/fileLock.ts` module as LUMI lane claims.

- File-based lane lock under `.broccolidb/governed/locks/`
- Heartbeat `<pulse>` on stdout
- Lane receipt at `.broccolidb/governed/receipts/{workerId}.json`

`CoordinatorService.spawnWorker()` invokes the CLI with workspace and lane context.

## Retry semantics

Each attempt gets a unique `attemptId`. Receipts are stored as `{swarmId}.governed.{attemptId}.json` with `parentAttemptId` linking retries. History is append-only in `.governed.history.jsonl`.

## Crash recovery

`LockAuthority.recoverStale()` prunes expired in-process claims, swarm mutex rows, and roadmap lane leases.

## Code entry points

- `LockAuthority` — unified ownership
- `GovernedSwarmCoordinator` — admission, lanes, seal
- `MergeGate` — merge safety
- `ReplayValidator` — deterministic replay checksum
- `LaneDAG` — dependency states
- `GovernedReceiptPanel` — operator UI
- `UseSubagentsToolHandler` — harness integration
