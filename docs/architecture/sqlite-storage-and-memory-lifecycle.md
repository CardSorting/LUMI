# SQLite Storage Retention & Memory Lifecycle Architecture

## Overview

DietCode employs SQLite as its primary persistence and coordination authority. To prevent exponential database growth on disk, eliminate V8 memory leaks, and guarantee sub-millisecond query performance under heavy subagent work, the system enforces a multi-pass storage retention, statement caching, checkpoint exclusion, and RAM tuning architecture.

---

## Architectural Principles & Subsystem Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BufferedDbPool / Kysely                           │
│  - 16 MB Page Cache (-16000)               - 5000ms Busy Timeout        │
│  - Bounded Chunk Insert (Zero-Allocation)  - Auto Maintenance Trigger    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SQLiteMaintenanceEngine                              │
│  - Universal Retention Policies (12+ Tables)  - Orphan CAS & Edge Pruning   │
│  - Freelist Vacuum Loop (freelist_count == 0)- Automated 32MB WAL Checkpoint│
│  - PRAGMA optimize Statistics                - Storage Budget Safety        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Checkpoint & Git Layer                             │
│  - Binary Exclusions (*.db, *.db-wal, *.db-shm, *.sqlite3)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Storage Retention & Database Maintenance (`SQLiteMaintenanceEngine`)

### Table Retention & Row Capping
Database tables are subject to automated time-based and row-count-based pruning to prevent exponential file size growth:

| Table | Retention Rule | Primary Key / Index |
|-------|---------------|-------------------|
| `claims` | Expiration timestamp (`expiresAt < now`) | `(repoPath, branch, path)` |
| `swarm_locks` | Expiration timestamp (`expiresAt < now`) | `resource` |
| `branches` | Ephemeral branches (`isEphemeral = 1` and `expiresAt < now`) | `(repoPath, name)` |
| `swarm_lock_generations` | Unused resource keys missing from `swarm_locks` | `resourceKey` |
| `telemetry` | Max 30 days OR 25,000 rows limit | `id`, `timestamp` |
| `audit_events` | Max 30 days OR 25,000 rows limit | `id`, `createdAt` |
| `nodes` | Max 10,000 rows limit | `id`, `timestamp` |
| `trees` | Max 10,000 rows limit | `(repoPath, id)`, `createdAt` |
| `stashes` | Max 14 days age cutoff | `id`, `createdAt` |
| `agent_streams` | Max 14 days age cutoff for completed/failed streams | `id`, `createdAt` |
| `agent_tasks` | Max 14 days age cutoff for completed/failed tasks | `id`, `createdAt` |
| `tasks` (legacy) | Max 14 days age cutoff for completed/failed tasks | `id`, `updatedAt` |
| `agent_cognitive_snapshots` | Max 30 days OR 5,000 rows limit | `id`, `createdAt` |
| `decisions` | Max 30 days age cutoff | `id`, `timestamp` |
| `task_lifecycle_events` | Max 14 days age cutoff | `monotonicSequence`, `committedAt` |
| `task_lifecycle_records` | Max 14 days age cutoff | `taskId`, `updatedAt` |
| `task_completions` & `task_rejections` | Max 14 days age cutoff | `taskId`, `committedAt` |
| `completion_attempts` | Max 14 days age cutoff | `completionAttemptId`, `createdAt` |
| `reflog` | Max 30 days age cutoff | `id`, `timestamp` |

### Orphan CAS File & Edge Garbage Collection
1. **Orphan CAS File Removal**: `files` rows whose CAS content hash (`id`) is no longer present in `trees` or `trees.entries` JSON blobs are deleted automatically during maintenance.
2. **Orphan Knowledge Graph Edges**: `knowledge_edges` and `agent_knowledge_edges` missing source or target nodes in `knowledge` or `agent_knowledge` are purged.
3. **Orphan Memory & Aggregates**: `agent_memory` rows for deleted streams and `telemetry_aggregates` rows for completed/deleted tasks are reclaimed.
4. **Dead Knowledge Decay Pruning**: `KnowledgeGraphService.decayConfidence()` deletes knowledge graph nodes and their edges when confidence falls below $\le 0.01$.

### Freelist Vacuuming & Resilient WAL Size Guardrails
- **Auto-Vacuum PRAGMA Execution Order**: `PRAGMA auto_vacuum = INCREMENTAL;` is executed *before* `PRAGMA journal_mode = WAL;` during DB initialization. An automated `VACUUM;` header check runs on startup if an existing database was initialized in `NONE` mode (`0`).
- **Freelist Vacuum Loop**: `incremental_vacuum(1000)` executes in a loop until `freelist_count === 0`, ensuring freed database pages are returned to the OS filesystem.
- **Resilient WAL Checkpoints**: When `.db-wal` size exceeds 32 MB or force truncation is requested, maintenance executes `wal_checkpoint(TRUNCATE)` with exponential backoff retries (up to 3 retries with 50ms pauses if busy readers are encountered), with dynamic fallback to `wal_checkpoint(PASSIVE)`.
- **Query Planner Optimization**: Runs `PRAGMA optimize` and FTS index segment optimization during routine and volume-triggered maintenance.

### Write-Volume Maintenance Triggers
In addition to the 5-minute interval timer, `BufferedDbPool` tracks `opsFlushedSinceMaintenance`. Flushing $\ge 10,000$ operations triggers a non-blocking background `runMaintenance()` pass immediately.

---

## 2. Prepared Statement Caching & Parameter Sizing (`Config.ts`, `BufferedDbPool.ts`)

### WeakMap Raw Statement Cache & Handle Disposal
`Config.ts` exports `getCachedStatement(db, sqlStr)` backed by a `WeakMap<object, Map<string, Statement>>`.
- Reuses compiled `better-sqlite3` statement handles across raw query paths (`TaskLifecyclePersistence`, `CompletionFunnel`, `SwarmMutexService`).
- **Explicit Handle Disposal**: Evicted statements in the 100-item LRU cache and statements cleared during `destroyDb()` or DB path listener changes explicitly invoke `(stmt as any).dispose?.()`, instantly releasing native C++ memory handles.

### Zero-Allocation Parameter Chunking
In `BufferedDbPool.ts`, `executeChunkedRawInsert` bounds parameter array sizing:
$$\text{CHUNK\_SIZE} = \min\left(100, \max\left(1, \left\lfloor \frac{\text{parameterBuffer.length}}{\max(1, \text{columns.length})} \right\rfloor\right)\right)$$
This strictly guarantees that chunk parameter flattening never exceeds `parameterBuffer.length` (2,000 slots), preventing V8 array expansion and sparse dictionary memory leaks.

---

## 3. Checkpoint Binary Database Exclusions (`CheckpointExclusions.ts`)

`CheckpointExclusions.ts` excludes binary SQLite files from Git checkpoint history tracking:
- `*.db`, `*.db-wal`, `*.db-shm`
- `*.sqlite`, `*.sqlite3`, `*.sqlite-wal`, `*.sqlite-shm`

This prevents checkpointing from saving binary database snapshots into Git commit history, eliminating exponential disk growth caused by duplicating database binaries across task steps.

---

## 4. PRAGMA RAM Tuning & Concurrency Guardrails

Standardized SQLite PRAGMA configuration enforced across `Config.ts` and `BufferedDbPool.ts`:

| PRAGMA | Configured Value | Rationale |
|--------|-----------------|-----------|
| `auto_vacuum` | `INCREMENTAL` | Reclaims freed pages on demand during maintenance runs (must precede `journal_mode`). |
| `journal_mode` | `WAL` | Enables concurrent readers and non-blocking write-behind flushes. |
| `synchronous` | `NORMAL` | Optimal durability and write performance in WAL mode. |
| `cache_size` | `-16000` (16 MB cap) | Caps page cache RAM per connection to 16 MB instead of 128 MB default. |
| `busy_timeout` | `5000` (5000 ms) | Prevents `SQLITE_BUSY` crashes under subagent lock contention. |
| `wal_autocheckpoint` | `1000` (1000 pages) | Checkpoints WAL log every 1000 pages (~4 MB). |
| `journal_size_limit` | `67108864` (64 MB) | Hard size cap for WAL journal log files. |
| `max_page_count` | `1073741824` (1 TB cap) | Database file growth guardrail preventing disk filling crashes. |

---

## 5. Event Listener & Context Memory Caps

- **Unsubscribable Listener Registries**: `Config.ts` `registerDbPathChangeListener` uses `Set<() => void>` and returns an unbind callback `() => void` to prevent listener retention leaks across DB path transitions.
- **Memory Value Length Capping**: `KnowledgeGraphService.appendMemoryLayer` caps string values at 50,000 characters to prevent unbounded memory row size growth.
- **Candidate Vector Search Bounding**: `KnowledgeGraphService.searchKnowledge` bounds fetched candidates (`limit(200)` and SQL filters) prior to parsing JSON embeddings in RAM.
