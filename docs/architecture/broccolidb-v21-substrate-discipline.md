# BroccoliDB v21 Substrate Discipline

BroccoliDB v21 treats the database layer as a substrate runtime for agentic systems, not as a convenience wrapper around SQLite. The substrate boundary owns lifecycle, durability, pressure handling, and failure semantics.

## Lifecycle Contract

Constructors are passive. They may receive dependencies and assign fields only.

Operational behavior begins in `start()`:

- `BufferedDbPool.start()` opens the configured Kysely and SQLite handles, verifies schema metadata, and starts the flush loop.
- `StorageService.start()` creates CAS directories and migrates legacy paste files into sharded CAS blobs.
- `CleanupService.start()` owns the recurring cleanup loop.
- `MutexService.start()` enables lock acquisition and heartbeat ownership.
- `LspService.start()` enables language-server operations. Child processes are still opened only by explicit LSP requests.
- `CoordinatorService.start()` restores active workers and starts heartbeat monitoring.
- `AgentContext.start()` is the high-level boot path and starts the lifecycle registry before initializing workspace rows.

Operational calls before `start()` or after `stop()` throw `LifecycleStateError`. The runtime does not lazily start missing components to preserve old call paths.

## Flush And Durability

All durability is routed through `flush()`.

`BufferedDbPool.flush()` coalesces concurrent calls through active and pending flush promises. Writes are swapped from the active buffer into an in-flight buffer and persisted in a SQLite transaction. Failed non-retryable flushes are moved to the dead-letter queue with error evidence. Retryable SQLite lock failures increment lock contention counters and eventually throw `DatabaseLockError` after retries are exhausted.

`AgentContext.flush()` routes through `LifecycleRegistry.flushAll()` so owned services expose one durability boundary.

After each successful DB flush, the pool checks the WAL file. If it exceeds 10 MB, it issues `PRAGMA wal_checkpoint(TRUNCATE)`.

## Backpressure

The write-behind queue is bounded:

- Below 5,000 pending writes: writes are accepted immediately.
- Between 5,000 and 20,000 pending writes: the pool waits for a coalesced flush with a 10,000 ms timeout.
- Above 20,000 pending writes: writes are rejected with `BackpressureError`.

If the coalesced flush does not finish in time, the caller receives `FlushTimeoutError`.

## Storage Integrity

CAS blobs are validated on read by recomputing SHA-256. A hash mismatch is treated as substrate corruption, not a cache miss.

Malformed blobs are moved to:

```text
.broccolidb/storage/corrupt/
```

The quarantine action appends a JSON line to:

```text
.broccolidb/storage/corrupt/manifest.jsonl
```

The read then throws `StorageIntegrityError`.

## Invariant Enforcement

`InvariantEngine` audits production files for architectural drift:

- banned legacy queue symbols
- `telemetry_queue.db*` files
- direct `better-sqlite3` database construction outside `Config.ts`
- background intervals without lifecycle ownership
- production references to transitional paste-store APIs

This keeps v21 from becoming lifecycle theater: the codebase must not retain hidden constructor-started loops beside a clean-looking registry.
