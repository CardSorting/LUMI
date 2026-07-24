// [LAYER: INFRASTRUCTURE]
// @classification MODERN
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type Database from 'better-sqlite3';
import { type Kysely, sql, type Transaction } from 'kysely';
import {
  destroyDb,
  getDb,
  getDbPath,
  getRawDb,
  registerDbPathChangeListener,
  type Schema,
} from './Config.js';
import {
  BackpressureError,
  DatabaseLockError,
  FlushTimeoutError,
  LifecycleStateError,
} from '../../core/errors.js';
import { lifecycleHealth, type ServiceHealth } from '../../core/agent-context/service-health.js';
import { Logger } from '../../shared/services/Logger.js';

import { AsyncLocalStorage } from 'node:async_hooks';

// Production-grade Re-entrant Mutex implementation
const mutexLocalStorage = new AsyncLocalStorage<string>();

class Mutex {
  private queue: { resolve: (release: () => void) => void; holderId: string; stack: string; timestamp: number }[] = [];
  private locked = false;
  private currentHolderId: string | null = null;

  constructor(public name: string, private timeoutMs: number = 30000) {}

  async acquire(): Promise<() => void> {
    const callerId = mutexLocalStorage.getStore() || crypto.randomUUID();
    const stack = new Error().stack || '';
    const timestamp = Date.now();

    // Re-entrancy: If the current async context already holds the lock, return a no-op release.
    if (this.locked && this.currentHolderId === callerId) {
      return () => {};
    }

    if (!this.locked) {
      this.locked = true;
      this.currentHolderId = callerId;
      return () => this.release();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.queue.findIndex(i => i.resolve === resolve);
        if (idx !== undefined && idx >= 0) {
            this.queue.splice(idx, 1);
            console.error(`[Mutex:${this.name}] 🚨 Deadlock timeout after ${this.timeoutMs}ms! Mutex held by ${this.currentHolderId}. Waiter stack:\n${stack}`);
            reject(new Error(`Mutex ${this.name} acquisition timeout`));
        }
      }, this.timeoutMs);

      this.queue.push({ 
          resolve: (releaseFn) => {
              clearTimeout(timeout);
              resolve(releaseFn);
          }, 
          holderId: callerId,
          stack, 
          timestamp 
      });
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      this.currentHolderId = next.holderId;
      next.resolve(() => this.release());
    } else {
      this.locked = false;
      this.currentHolderId = null;
    }
  }

  /**
   * Execute a callback within an async context that carries the lock owner identity.
   * This enables re-entrant calls to nested locked methods.
   */
  async runLocked<T>(callback: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await mutexLocalStorage.run(this.currentHolderId!, callback);
    } finally {
      release();
    }
  }
}

export type DbLayer = 'domain' | 'infrastructure' | 'ui' | 'plumbing';

type WhereCondition = {
  column: string;
  value: string | number | string[] | number[] | null;
  operator?:
    | '='
    | '<'
    | '>'
    | '<='
    | '>='
    | '!='
    | 'IN'
    | 'in'
    | 'In'
    | 'UNSAFE_IN'
    | 'IS'
    | 'IS NOT'
    | 'LIKE';
};

export type Increment = { _type: 'increment'; value: number };

export type WriteOp = {
  type: 'insert' | 'update' | 'delete' | 'upsert';
  table: keyof Schema;
  values?: Record<string, unknown | Increment>;
  where?: WhereCondition | WhereCondition[];
  conflictTarget?: string | string[]; // For upserts
  agentId?: string;
  layer?: DbLayer;
  // Level 6: Pre-calculated Metadata
  hasIncrements?: boolean;
  dedupKey?: string;
};

const LAYER_PRIORITY: Record<DbLayer, number> = {
  domain: 0,
  infrastructure: 1,
  ui: 2,
  plumbing: 3,
};

const TYPE_PRIORITY: Record<string, number> = {
  insert: 0,
  upsert: 1,
  update: 2,
  delete: 3,
};

const INDEXED_COLUMNS: Record<string, string[]> = {
  queue_jobs: ['status'],
  agent_tasks: ['status'],
  knowledge: ['type'],
  agent_knowledge: ['type'],
};

const BACKPRESSURE_SOFT_LIMIT = 5000;
const BACKPRESSURE_HARD_LIMIT = 20000;
const BACKPRESSURE_FLUSH_TIMEOUT_MS = 10000;
const WAL_TRUNCATE_THRESHOLD_BYTES = 10 * 1024 * 1024;

const PRIMARY_KEYS: Record<string, string[]> = {
  users: ['id'],
  workspaces: ['id'],
  repositories: ['id'],
  branches: ['repoPath', 'name'],
  tags: ['repoPath', 'name'],
  nodes: ['id'],
  trees: ['repoPath', 'id'],
  files: ['id'],
  reflog: ['id'],
  stashes: ['id'],
  claims: ['repoPath', 'branch', 'path'],
  telemetry: ['id'],
  telemetry_aggregates: ['repoPath', 'id'],
  agents: ['id'],
  knowledge: ['id'],
  tasks: ['id'],
  audit_events: ['id'],
  settings: ['key'],
  logical_constraints: ['id'],
  knowledge_edges: ['sourceId', 'targetId', 'type'],
  decisions: ['id'],
  queue_jobs: ['id'],
  queue_settings: ['key'],
  agent_streams: ['id'],
  agent_tasks: ['id'],
  agent_memory: ['streamId', 'key'],
  agent_cognitive_snapshots: ['id'],
  agent_knowledge: ['id'],
  agent_knowledge_edges: ['sourceId', 'targetId', 'type'],
  swarm_locks: ['resource'],
};

function normalizeWhere(where: WhereCondition | WhereCondition[] | undefined): WhereCondition[] {
  if (!where) return [];
  return Array.isArray(where) ? where : [where];
}

/**
 * BufferedDbPool provides a high-performance, asynchronous write-behind layer
 * over SQLite. It batches operations, manages agent-specific uncommitted state,
 * and ensures data consistency between in-memory buffers and on-disk storage.
 */
export class BufferedDbPool {
  private lifecycleState: 'new' | 'starting' | 'started' | 'stopping' | 'stopped' = 'new';
  private startPromise: Promise<void> | null = null;
  private bufferA = new Map<keyof Schema, WriteOp[]>();
  private bufferB = new Map<keyof Schema, WriteOp[]>();
  private activeBuffer: Map<keyof Schema, WriteOp[]> = this.bufferA;
  private inFlightOps: Map<keyof Schema, WriteOp[]> = new Map();
  private agentShadows = new Map<
    string,
    { ops: WriteOp[]; affectedFiles: Set<string>; lastUpdated: number }
  >();
  private stateMutex = new Mutex('DbStateMutex');
  private initMutex = new Mutex('DbInitMutex');
  private flushInterval: NodeJS.Timeout | null = null;
  private db: Kysely<Schema> | null = null;
  private rawDb: Database.Database | null = null;
  private totalTransactions = 0;
  private stmtCache = new Map<string, Database.Statement>();
  private parameterBuffer = new Array(2000); // Pre-allocated for chunked inserts
  private activeBufferSize = 0;
  private inFlightSize = 0;
  // Level 7: Event Horizon Status Index (O(1) Query Mapping)
  private activeIndex = new Map<keyof Schema, Map<string, Set<WriteOp>>>();
  private inFlightIndex = new Map<keyof Schema, Map<string, Set<WriteOp>>>();
  private warmedIndices = new Set<string>(); // Level 9: Authoritative Memory Indices
  private integrityMetrics = { brokenImports: 0, orphanedNodes: 0 };
  private SCHEMA_VERSION = 2; // Pass 4 hardening baseline
  private schemaVerified = false;
  private deadLetterQueue: { op: WriteOp; error: string; timestamp: number }[] = [];
  private activeFlushPromise: Promise<void> | null = null;
  private pendingFlushPromise: Promise<void> | null = null;
  private lastSuccessfulFlush: number | null = null;
  private lastFlushLatency = 0;
  private failedWriteCount = 0;
  private lockContentionCount = 0;

  public getDeadLetterQueue() {
    return this.deadLetterQueue;
  }

  public clearDeadLetterQueue() {
    this.deadLetterQueue = [];
  }

  constructor() {}

  public async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError('BufferedDbPool cannot be restarted after stop().');
    }
    if (this.startPromise) return this.startPromise;

    this.lifecycleState = 'starting';
    this.startPromise = (async () => {
      this.db = await getDb();
      this.rawDb = await getRawDb();

      await sql`PRAGMA cache_size = -128000;`.execute(this.db);
      await sql`PRAGMA temp_store = MEMORY;`.execute(this.db);
      await sql`PRAGMA journal_mode = WAL;`.execute(this.db);
      await sql`PRAGMA synchronous = NORMAL;`.execute(this.db);
      await sql`PRAGMA mmap_size = 2147483648;`.execute(this.db);
      await sql`PRAGMA threads = 4;`.execute(this.db);
      await sql`PRAGMA auto_vacuum = INCREMENTAL;`.execute(this.db);
      await sql`PRAGMA wal_autocheckpoint = 1000;`.execute(this.db);
      await sql`PRAGMA journal_size_limit = 67108864;`.execute(this.db);
      await this.verifySchemaVersion();

      registerDbPathChangeListener(() => {
        this.db = null;
        this.rawDb = null;
        this.stmtCache.clear();
        this.schemaVerified = false;
        if (this.lifecycleState === 'started') {
          this.lifecycleState = 'stopped';
        }
      });

      this.lifecycleState = 'started';
      this.startFlushLoop();
    })()
      .catch((error) => {
        this.lifecycleState = 'new';
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  private assertOperational(operation: string, allowStopping = false): void {
    if (this.lifecycleState === 'new' || this.lifecycleState === 'starting') {
      throw new LifecycleStateError(`BufferedDbPool.${operation}() called before start().`);
    }
    if (this.lifecycleState === 'stopping' && !allowStopping) {
      throw new LifecycleStateError(`BufferedDbPool.${operation}() called while stop() is in progress.`);
    }
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError(`BufferedDbPool.${operation}() called after stop().`);
    }
  }

  private requireDb(operation: string, allowStopping = false): Kysely<Schema> {
    this.assertOperational(operation, allowStopping);
    if (!this.db) {
      throw new LifecycleStateError(`BufferedDbPool.${operation}() has no active Kysely handle.`);
    }
    return this.db;
  }

  private async verifySchemaVersion() {
      if (this.schemaVerified) return;
      try {
          await this.db!.schema
            .createTable('system_metadata')
            .ifNotExists()
            .addColumn('key', 'text', (col) => col.primaryKey())
            .addColumn('value', 'text')
            .execute();

          const versionDoc = await this.db!
            .selectFrom('system_metadata' as any)
            .selectAll()
            .where('key', '=', 'schema_version')
            .executeTakeFirst() as { key: string, value: string } | undefined;

          if (!versionDoc) {
              await this.db!
                .insertInto('system_metadata' as any)
                .values({ key: 'schema_version', value: String(this.SCHEMA_VERSION) })
                .execute();
          } else if (Number(versionDoc.value) < this.SCHEMA_VERSION) {
              console.warn(`[DbPool] 🚨 Schema Migration Required: v${versionDoc.value} -> v${this.SCHEMA_VERSION}. Auto-patching metadata.`);
              await this.db!
                .updateTable('system_metadata' as any)
                .set({ value: String(this.SCHEMA_VERSION) })
                .where('key', '=', 'schema_version')
                .execute();
          }
          this.schemaVerified = true;
      } catch (e) {
          console.error('[DbPool] Schema verification failed:', e);
      }
  }

  private flushTimeout: NodeJS.Timeout | null = null;
  private currentFlushDelay: number | null = null;

  /**
   * Adaptive flush scheduling.
   */
  private scheduleFlush(delay = 10) {
    if (this.lifecycleState !== 'started') return;
    if (this.flushTimeout) {
      if (this.currentFlushDelay !== null && this.currentFlushDelay <= delay) {
        return;
      }
      clearTimeout(this.flushTimeout);
    }

    this.currentFlushDelay = delay;
    this.flushTimeout = setTimeout(async () => {
      if (this.lifecycleState !== 'started') return;
      this.currentFlushDelay = null;
      this.flushTimeout = null;
      try {
        await this.flush();
      } finally {
        const release = await this.stateMutex.acquire();
        try {
          let hasData = false;
          for (const ops of Array.from(this.activeBuffer.values())) {
            if (ops.length > 0) {
              hasData = true;
              break;
            }
          }
          if (hasData) {
            this.scheduleFlush(10);
          }
        } finally {
          release();
        }
      }
    }, delay);
  }

  private cleanupInterval: NodeJS.Timeout | null = null;

  private startFlushLoop() {
    if (this.flushInterval) return;
    this.scheduleFlush(1000);
    this.flushInterval = setInterval(() => this.scheduleFlush(1000), 1000);
    this.cleanupInterval = setInterval(() => {
      this.pruneExpiredShadows().catch(() => {});
    }, 30000);
    this.flushInterval.unref?.();
    this.cleanupInterval.unref?.();
  }

  public async pruneExpiredShadows(maxAgeMs = 5 * 60 * 1000): Promise<number> {
    this.assertOperational('pruneExpiredShadows');
    const release = await this.stateMutex.acquire();
    let pruned = 0;
    try {
      const now = Date.now();
      for (const [agentId, shadow] of Array.from(this.agentShadows.entries())) {
        if (now - shadow.lastUpdated > maxAgeMs) {
          this.agentShadows.delete(agentId);
          pruned++;
        }
      }
    } finally {
      release();
    }
    return pruned;
  }

  public async beginWork(agentId: string) {
    this.assertOperational('beginWork');
    const release = await this.stateMutex.acquire();
    try {
      if (!this.agentShadows.has(agentId)) {
        this.agentShadows.set(agentId, {
          ops: [],
          affectedFiles: new Set(),
          lastUpdated: Date.now(),
        });
      }
    } finally {
      release();
    }
  }

  public async push(op: WriteOp, agentId?: string, affectedFile?: string) {
    return this.pushBatch([op], agentId, affectedFile);
  }

  private getShadowWriteCount(): number {
    let count = 0;
    for (const shadow of this.agentShadows.values()) {
      count += shadow.ops.length;
    }
    return count;
  }

  private getPendingWriteCount(): number {
    return this.activeBufferSize + this.inFlightSize + this.getShadowWriteCount();
  }

  private getDurableFlushableWriteCount(): number {
    return this.activeBufferSize + this.inFlightSize;
  }

  private async enforceBackpressure(incomingWriteCount: number): Promise<void> {
    const pendingWriteCount = this.getPendingWriteCount() + incomingWriteCount;
    if (pendingWriteCount > BACKPRESSURE_HARD_LIMIT) {
      throw new BackpressureError(
        `BufferedDbPool rejected ${incomingWriteCount} writes with ${pendingWriteCount} pending writes. Hard limit is ${BACKPRESSURE_HARD_LIMIT}.`
      );
    }

    if (pendingWriteCount > BACKPRESSURE_SOFT_LIMIT) {
      await this.flushWithTimeout(BACKPRESSURE_FLUSH_TIMEOUT_MS);
      const postFlushPending = this.getPendingWriteCount() + incomingWriteCount;
      if (postFlushPending > BACKPRESSURE_HARD_LIMIT) {
        throw new BackpressureError(
          `BufferedDbPool rejected ${incomingWriteCount} writes after flush; ${postFlushPending} writes remain pending. Hard limit is ${BACKPRESSURE_HARD_LIMIT}.`
        );
      }
    }
  }

  private async flushWithTimeout(timeoutMs: number): Promise<void> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        this.requestFlush(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new FlushTimeoutError(
                  `BufferedDbPool flush exceeded ${timeoutMs}ms while under backpressure.`
                )
              ),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async ensureDb(): Promise<Kysely<Schema>> {
    return this.requireDb('ensureDb');
  }

  private readonly MAX_STMT_CACHE_SIZE = 250;

  private getStatement(sqlStr: string): Database.Statement {
    let stmt = this.stmtCache.get(sqlStr);
    if (!stmt && this.rawDb) {
      stmt = this.rawDb.prepare(sqlStr);
      if (this.stmtCache.size >= this.MAX_STMT_CACHE_SIZE) {
        const oldestKey = this.stmtCache.keys().next().value;
        if (oldestKey !== undefined) {
          const oldStmt = this.stmtCache.get(oldestKey);
          try {
            (oldStmt as { dispose?: () => void })?.dispose?.();
          } catch {}
          this.stmtCache.delete(oldestKey);
        }
      }
      this.stmtCache.set(sqlStr, stmt);
    }
    return stmt!;
  }

  private enqueueLatencies: number[] = [];
  private processingLatencies: number[] = [];
  private MAX_METRICS_SAMPLES = 5000;

  private recordLatency(target: number[], value: number) {
    target.push(value);
    if (target.length > this.MAX_METRICS_SAMPLES) {
      target.shift();
    }
  }

  private calculatePercentile(samples: number[], percentile: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] ?? 0;
  }

  public async pushBatch(ops: WriteOp[], agentId?: string, affectedFile?: string) {
    this.assertOperational('pushBatch');
    if (ops.length === 0) return;
    await this.enforceBackpressure(ops.length);

    const enqueueStart = performance.now();
    let currentBufferLength = 0;

    for (const op of ops) {
      if (agentId) op.agentId = agentId;

      // Level 6: Pre-calculate metadata to avoid hot-path scans
      op.hasIncrements = false;
      if (op.values) {
        for (const v of Object.values(op.values)) {
          if (this.isIncrement(v)) {
            op.hasIncrements = true;
            break;
          }
        }
      }

      if (op.type === 'update' && op.where) {
        const tablePks = PRIMARY_KEYS[op.table as string] || ['id'];
        const conditions = normalizeWhere(op.where);
        const allPksMatched = tablePks.every(pk => {
          const cond = conditions.find(c => c.column === pk && (c.operator === '=' || c.operator === undefined));
          return cond !== undefined && !Array.isArray(cond.value);
        });

        if (allPksMatched && conditions.length === tablePks.length) {
          const pkVals = tablePks.map(pk => {
            const cond = conditions.find(c => c.column === pk)!;
            return String(cond.value);
          });
          op.dedupKey = `${op.table as string}:${pkVals.join('::')}`;
        }
      }

      // Level 7: Index maintenance (O(1))
      this.addStatusIndex(op, this.activeIndex);
    }

    if (agentId) {
      // Level 3 Optimization: Lock-free shadow access
      // Each agent is isolated; we only lock if we need to create the entry for the first time.
      let shadow = this.agentShadows.get(agentId);

      if (!shadow) {
        const release = await this.stateMutex.acquire();
        try {
          shadow = this.agentShadows.get(agentId) ?? {
            ops: [],
            affectedFiles: new Set<string>(),
            lastUpdated: Date.now(),
          };
          this.agentShadows.set(agentId, shadow);
        } finally {
          release();
        }
      }

      // Safe to push without stateMutex because this agentId is unique to this caller
      for (const op of ops) {
        shadow.ops.push({ ...op, agentId });
      }
      if (affectedFile) shadow.affectedFiles.add(affectedFile);
      shadow.lastUpdated = Date.now();
    } else {
      let tableBuffer = this.activeBuffer.get(ops[0]?.table);
      if (!tableBuffer) {
        tableBuffer = [];
        this.activeBuffer.set(ops[0]?.table, tableBuffer);
      }
      tableBuffer.push(...ops);
      this.activeBufferSize += ops.length;
      currentBufferLength = this.activeBufferSize;
    }

    const shouldFlush = currentBufferLength >= 10000;

    this.recordLatency(this.enqueueLatencies, performance.now() - enqueueStart);
    if (shouldFlush) {
      this.scheduleFlush(0);
    } else {
      this.scheduleFlush(5);
    }
  }

  public async commitWork(agentId: string) {
    this.assertOperational('commitWork');
    let shadowOpsCount = 0;
    const release = await this.stateMutex.acquire();
    try {
      const shadow = this.agentShadows.get(agentId);
      this.agentShadows.delete(agentId);
      if (shadow && shadow.ops.length > 0) {
        shadowOpsCount = shadow.ops.length;
        for (const op of shadow.ops) {
          let tableBuffer = this.activeBuffer.get(op.table);
          if (!tableBuffer) {
            tableBuffer = [];
            this.activeBuffer.set(op.table, tableBuffer);
          }
          tableBuffer.push(op);
          this.activeBufferSize++;

          // Level 7: Index maintenance (O(1))
          this.addStatusIndex(op, this.activeIndex);
        }
      }
    } finally {
      release();
    }

    if (shadowOpsCount > 0) {
      this.scheduleFlush(0);
    }
  }

  public async rollbackWork(agentId: string) {
    this.assertOperational('rollbackWork');
    const release = await this.stateMutex.acquire();
    try {
      this.agentShadows.delete(agentId);
    } finally {
      release();
    }
  }

  public async runTransaction<T>(callback: (agentId: string) => Promise<T>): Promise<T> {
    this.assertOperational('runTransaction');
    const agentId = `trx-${crypto.randomUUID()}`;
    await this.beginWork(agentId);
    try {
      const result = await callback(agentId);
      await this.commitWork(agentId);
      return result;
    } catch (e) {
      await this.rollbackWork(agentId);
      throw e;
    }
  }

  public async flush(): Promise<void> {
    this.assertOperational('flush');
    return this.requestFlush();
  }

  private requestFlush(allowStopping = false): Promise<void> {
    this.assertOperational('flush', allowStopping);
    if (this.activeFlushPromise) {
      if (!this.pendingFlushPromise) {
        const pendingFlush = this.activeFlushPromise.then(() => this.runFlushCycle());
        const trackedPendingFlush = pendingFlush.finally(() => {
          if (this.activeFlushPromise === trackedPendingFlush) {
            this.activeFlushPromise = null;
          }
          this.pendingFlushPromise = null;
        });
        this.pendingFlushPromise = trackedPendingFlush;
        this.activeFlushPromise = trackedPendingFlush;
      }
      return this.pendingFlushPromise;
    }

    const activeFlush = this.runFlushCycle();
    const trackedActiveFlush = activeFlush.finally(() => {
      if (this.activeFlushPromise === trackedActiveFlush) {
        this.activeFlushPromise = null;
      }
    });
    this.activeFlushPromise = trackedActiveFlush;
    return trackedActiveFlush;
  }

  private async runFlushCycle(retryCount: number = 0): Promise<void> {
    let opsToFlush: WriteOp[] = [];
    const startTime = Date.now();

    try {
      const releaseState = await this.stateMutex.acquire();
      let hasData = false;
      try {
        const dirtyBuffer = this.activeBuffer;
        for (const ops of Array.from(dirtyBuffer.values())) {
          if (ops.length > 0) {
            hasData = true;
            break;
          }
        }

        if (hasData) {
          // Atomic Swap: Infinite Horizon (Partitioned)
          this.activeBuffer = dirtyBuffer === this.bufferA ? this.bufferB : this.bufferA;
          this.activeBuffer.clear(); // Reset the new active buffer map
          this.inFlightSize = this.activeBufferSize;
          this.activeBufferSize = 0;

          this.inFlightOps = dirtyBuffer;

          // Level 7: Index Swap
          this.inFlightIndex = this.activeIndex;
          this.activeIndex = new Map();

          opsToFlush = Array.from(dirtyBuffer.values())
            .flat()
            .sort((a, b) => {
              const pA = (LAYER_PRIORITY as any)[a.layer ?? 'plumbing'];
              const pB = (LAYER_PRIORITY as any)[b.layer ?? 'plumbing'];
              if (pA !== pB) return pA - pB;
              if (a.table !== b.table) return (a.table as string).localeCompare(b.table as string);
              const typeA = TYPE_PRIORITY[a.type] ?? 99;
              const typeB = TYPE_PRIORITY[b.type] ?? 99;
              return typeA - typeB;
            });
        } else if (this.inFlightOps.size > 0) {
          opsToFlush = Array.from(this.inFlightOps.values()).flat();
        }
      } finally {
        releaseState();
      }

      if (opsToFlush.length === 0) return;

      const db = this.requireDb('flush', true);
      let totalFlushed = 0;
      this.totalTransactions++;

      await db.transaction().execute(async (trx) => {
        const processedGroups = this.groupOps(opsToFlush);

        for (const group of processedGroups) {
          const first = group[0];
          if (!first) continue;
          const table = first.table;

          // High-Performance Path: Chunked Raw SQL (Level 3 Quantum Boost)
          if (group.length >= 100 && first.type === 'insert' && this.rawDb) {
            totalFlushed += await this.executeChunkedRawInsert(table, group);
          } else if (group.length > 1 && first.type === 'insert') {
            totalFlushed += await this.executeBulkInsert(trx, table, group);
          } else if (group.length > 1 && first.type === 'update') {
            totalFlushed += await this.executeBulkUpdate(trx, table, group);
          } else {
            for (const op of group) {
              await this.executeSingleOp(trx, op);
              totalFlushed++;
            }
          }
        }
      });

      const duration = Date.now() - startTime;
      this.lastSuccessfulFlush = Date.now();
      this.lastFlushLatency = duration;
      this.recordLatency(this.processingLatencies, duration);

      const throughput = Math.round(totalFlushed / (duration / 1000 || 0.001));
      if (duration > 50 || totalFlushed > 1000) {
        const p95p = this.calculatePercentile(this.processingLatencies, 95);
        const p99p = this.calculatePercentile(this.processingLatencies, 99);
        const p95e = this.calculatePercentile(this.enqueueLatencies, 95);
        console.log(
          `[DbPool] Flush: ${totalFlushed} ops in ${duration}ms (${throughput} ops/sec) | Latency: p95_proc=${p95p.toFixed(1)}ms, p99_proc=${p99p.toFixed(1)}ms, p95_enq=${p95e.toFixed(2)}ms`
        );
      }

      const releaseStateClear = await this.stateMutex.acquire();
      try {
        this.inFlightOps.clear();
        this.inFlightSize = 0;
        this.inFlightIndex.clear();
      } finally {
        releaseStateClear();
      }
      await this.checkpointWalIfNeeded();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const isRetryable =
        err.code === 'SQLITE_BUSY' ||
        err.code === 'SQLITE_LOCKED' ||
        err.code === 'SQLITE_MISUSE' ||
        err.message?.includes('deadlock') ||
        err.message?.includes('closed') ||
        err.message?.includes('destroyed') ||
        err.message?.includes('interrupted') ||
        err.message?.includes('Library used incorrectly');

      if (isRetryable && retryCount < 3) {
          this.lockContentionCount++;
          const delay = Math.pow(2, retryCount) * 100;
          console.warn(`[DbPool] ⚠️ Flush conflict (SQLITE_BUSY). Retrying in ${delay}ms... (Attempt ${retryCount + 1})`);
          await new Promise(r => setTimeout(r, delay));
          return this.runFlushCycle(retryCount + 1);
      }

      const releaseStateFail = await this.stateMutex.acquire();
      try {
      if (isRetryable) {
        this.lockContentionCount++;
        for (const op of opsToFlush) {
          let tableBuffer = this.activeBuffer.get(op.table);
          if (!tableBuffer) {
            tableBuffer = [];
            this.activeBuffer.set(op.table, tableBuffer);
          }
          tableBuffer.unshift(op);
          this.activeBufferSize++;

          // Level 7: Restore index
          this.addStatusIndex(op, this.activeIndex);
        }
      } else {
        Logger.error(`[DbPool] ❌ Flush failed (FATAL):`, e);
        const errMsg = err.message || String(e);
        this.failedWriteCount += opsToFlush.length;
        for (const op of opsToFlush) {
          this.deadLetterQueue.push({ op, error: errMsg, timestamp: Date.now() });
          if (this.deadLetterQueue.length > 1000) {
            this.deadLetterQueue.shift();
          }
        }
      }
      this.inFlightOps.clear();
        this.inFlightSize = 0;
        this.inFlightIndex.clear();
      } finally {
        releaseStateFail();
      }
      if (isRetryable) {
        throw new DatabaseLockError(
          `SQLite lock contention exhausted retries while flushing ${opsToFlush.length} writes: ${err.message || String(e)}`
        );
      }
    }
  }

  private async executeBulkUpdate(
    trx: Transaction<Schema>,
    table: keyof Schema,
    group: WriteOp[]
  ): Promise<number> {
    if (group.length === 0) return 0;
    const first = group[0];
    if (!first?.values) return 0;

    const canBatchIntoSingleStatement = group.every(
      (op) =>
        this.isSameValues(op.values as any, first.values as any) &&
        op.where &&
        !Array.isArray(op.where) &&
        op.where.column === 'id' &&
        (op.where.operator === '=' || op.where.operator === undefined)
    );

    if (canBatchIntoSingleStatement && first.where && !Array.isArray(first.where)) {
      const ids: unknown[] = [];
      for (const op of group) {
        const val = (op.where as WhereCondition).value;
        if (Array.isArray(val)) {
          ids.push(...val);
        } else {
          ids.push(val);
        }
      }

      const valuesWithNoIncrements: Record<string, unknown> = {};
      const increments: Record<string, number> = {};
      for (const [k, v] of Object.entries(first.values)) {
        if (this.isIncrement(v)) {
          increments[k] = v.value;
        } else {
          valuesWithNoIncrements[k] = v;
        }
      }

      const query = trx.updateTable(table);
      const sets: Record<string, unknown> = { ...valuesWithNoIncrements };
      for (const [k, v] of Object.entries(increments)) {
        sets[k] = sql`${sql.ref(k)} + ${v}`;
      }

      await query
        .set(sets as never)
        .where('id' as never, 'in', ids as never)
        .execute();
      return group.length;
    }

    const promises = group.map((op) => this.executeSingleOp(trx, op));
    await Promise.all(promises);
    return group.length;
  }

  public async selectWhere<T extends keyof Schema>(
    table: T,
    where: WhereCondition | WhereCondition[],
    agentId?: string,
    options?: {
      orderBy?: { column: keyof Schema[T]; direction: 'asc' | 'desc' };
      limit?: number;
    }
  ): Promise<Schema[T][]> {
    const release = await this.stateMutex.acquire();
    try {
      const db = await this.ensureDb();
      const conditions = normalizeWhere(where);
      const statusCond = conditions.find(
        (c) => (c.column === 'status' || c.column === 'type') && (c.operator === '=' || !c.operator)
      );
      const indexKey = statusCond
        ? `${table as string}:${statusCond.column}:${statusCond.value}`
        : null;
      const isWarmed = indexKey && this.warmedIndices.has(indexKey);

      let diskResults: Schema[T][] = [];
      if (!isWarmed) {
        let query = db.selectFrom(table).selectAll();
        for (const cond of conditions) {
          const opStr = cond.operator || '=';
          if (Array.isArray(cond.value)) {
            query = (query as any).where(cond.column, 'in', cond.value);
          } else {
            query = (query as any).where(cond.column, opStr, cond.value);
          }
        }

        if (options?.orderBy) {
          query = (query as any).orderBy(options.orderBy.column, options.orderBy.direction);
        }
        if (options?.limit) {
          query = (query as any).limit(options.limit);
        }
        diskResults = (await query.execute()) as Schema[T][];
      }

      const applyOps = (
        ops: WriteOp[],
        sourceIndex: Map<string, Set<WriteOp>> | undefined,
        target: Schema[T][]
      ) => {
        // Level 7: Fast-Path Status Indexing
        const statusCond = conditions.find(
          (c) =>
            (c.column === 'status' || c.column === 'type') && (c.operator === '=' || !c.operator)
        );
        let tableOps: Iterable<WriteOp> = [];

        if (statusCond && sourceIndex) {
          const key = `${statusCond.column}:${statusCond.value}`;
          const set = sourceIndex.get(key) || new Set();
          const extraOps = ops.filter(op => op.type === 'update' || op.type === 'delete' || op.type === 'upsert');
          tableOps = [...set, ...extraOps];
        } else {
          tableOps = ops;
        }

        for (const op of Array.from(tableOps)) {
          // Additional safety check if we're using a full buffer instead of an index
          if (op.table !== table) continue;

          const applyValues = (
            existing: unknown,
            newValues: Record<string, unknown>,
            hasIncs?: boolean
          ) => {
            const next = { ...(existing as Record<string, unknown>) };
            for (const [k, v] of Object.entries(newValues)) {
              if (hasIncs && this.isIncrement(v)) {
                next[k] = (Number(next[k]) || 0) + v.value;
              } else {
                next[k] = v;
              }
            }
            return next as Schema[T];
          };

          const opWhere = normalizeWhere(op.where);

          // Pre-compute Sets for IN operators to O(1) lookup
          const inSets = opWhere.map((c) => {
            if (c.operator?.toUpperCase() === 'IN' && Array.isArray(c.value)) {
              return new Set(c.value as unknown[]);
            }
            return null;
          });

          const matches = (r: unknown, queryConditions: WhereCondition[]) => {
            const row = r as Record<string, unknown>;
            if (queryConditions.length === 0) return true;
            return queryConditions.every((c, idx) => {
              const val = row[c.column];
              const opStr = (c.operator || '=').toUpperCase();

              if (opStr === 'IN') {
                // If this is matching against the op's where, use the pre-computed set
                // If this is matching against the SELECT's where, just use the array
                if (queryConditions === opWhere) {
                  const set = inSets[idx];
                  if (set) return set.has(val as any);
                }
                if (Array.isArray(c.value)) return (c.value as unknown[]).includes(val);
                return val === c.value;
              }
              if (opStr === '=') return val === c.value;
              if (opStr === '!=') return val !== c.value;
              if (opStr === '>') return Number(val) > Number(c.value);
              if (opStr === '<') return Number(val) < Number(c.value);
              if (opStr === '>=') return Number(val) >= Number(c.value);
              if (opStr === '<=') return val !== null && Number(val) <= Number(c.value);
              if (opStr === 'LIKE') {
                  if (typeof val !== 'string' || typeof c.value !== 'string') return false;
                  const pattern = c.value.replace(/%/g, '.*').replace(/_/g, '.');
                  return new RegExp(`^${pattern}$`, 'i').test(val);
              }
              return false;
            });
          };

          if (op.type === 'insert' && op.values) {
            const pkMatch = (r: unknown) => {
              const row = r as Record<string, unknown>;
              const opVals = op.values as Record<string, unknown>;
              const cols = PRIMARY_KEYS[table as string] || ['id'];
              return cols.every(col => row[col] !== undefined && opVals[col] !== undefined && row[col] === opVals[col]);
            };
            const existingIdx = target.findIndex(pkMatch);
            if (existingIdx >= 0) {
              const newRow = { ...op.values } as unknown as Schema[T];
              if (matches(newRow, conditions)) {
                target[existingIdx] = newRow;
              } else {
                target.splice(existingIdx, 1);
              }
            } else {
              const newRow = { ...op.values } as unknown as Schema[T];
              if (matches(newRow, conditions)) target.push(newRow);
            }
          } else if (op.type === 'upsert' && op.values) {
            const pkMatch = (r: unknown) => {
              const row = r as Record<string, unknown>;
              if (opWhere.length > 0) return matches(row, opWhere);
              const opVals = op.values as Record<string, unknown>;
              const cols = PRIMARY_KEYS[table as string] || ['id'];
              return cols.every(col => row[col] !== undefined && opVals[col] !== undefined && row[col] === opVals[col]);
            };
            const existingIdx = target.findIndex(pkMatch);
            if (existingIdx >= 0) {
              const existing = target[existingIdx];
              if (existing) {
                const next = applyValues(
                  existing,
                  op.values as Record<string, unknown>,
                  op.hasIncrements
                );
                if (matches(next, conditions)) {
                  target[existingIdx] = next;
                } else {
                  target.splice(existingIdx, 1);
                }
              }
            } else {
              const newRow = { ...op.values } as unknown as Schema[T];
              if (matches(newRow, conditions)) target.push(newRow);
            }
          } else if (op.type === 'update' && op.values) {
            for (let i = target.length - 1; i >= 0; i--) {
              const existing = target[i];
              if (existing && matches(existing, opWhere)) {
                const next = applyValues(
                  existing,
                  op.values as Record<string, unknown>,
                  op.hasIncrements
                );
                if (matches(next, conditions)) {
                  target[i] = next;
                } else {
                  target.splice(i, 1);
                }
              }
            }
          } else if (op.type === 'delete') {
            for (let i = target.length - 1; i >= 0; i--) {
              const existing = target[i];
              if (existing && matches(existing, opWhere)) target.splice(i, 1);
            }
          }
        }
      };

      let finalResults = [...diskResults];
      applyOps(this.inFlightOps.get(table) || [], this.inFlightIndex.get(table), finalResults);
      applyOps(this.activeBuffer.get(table) || [], this.activeIndex.get(table), finalResults);
      if (agentId) {
        const shadow = this.agentShadows.get(agentId);
        if (shadow) applyOps(shadow.ops, undefined, finalResults);
      }

      if (options?.orderBy) {
        const col = options.orderBy.column as string;
        const dir = options.orderBy.direction;
        finalResults.sort((a, b) => {
          const valA = (a as Record<string, unknown>)[col];
          const valB = (b as Record<string, unknown>)[col];
          if (valA === undefined || valB === undefined || valA === null || valB === null) return 0;
          if (valA < valB) return dir === 'asc' ? -1 : 1;
          if (valA > valB) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
      if (options?.limit) finalResults = finalResults.slice(0, options.limit);
      return finalResults;
    } finally {
      release();
    }
  }

  public async selectOne<T extends keyof Schema>(
    table: T,
    where: WhereCondition | WhereCondition[],
    agentId?: string
  ): Promise<Schema[T] | null> {
    const results = await this.selectWhere(table, where, agentId);
    return results.length > 0 ? (results[0] as Schema[T]) : null;
  }

  public static increment(value: number): Increment {
    return { _type: 'increment', value };
  }

  private groupOps(ops: WriteOp[]): WriteOp[][] {
    const coalescedOps: WriteOp[] = [];
    const updateCache = new Map<string, number>();
    const insertCache = new Map<string, number>();

    for (const op of ops) {
      if (op.type === 'update' && op.dedupKey) {
        const existingIdx = updateCache.get(op.dedupKey);
        if (existingIdx !== undefined) {
          const targetOp = coalescedOps[existingIdx];
          if (targetOp?.values && op.values) {
            for (const [key, val] of Object.entries(op.values)) {
              const existingVal: any = targetOp.values[key];
              const isInc = (v: any) =>
                v && typeof v === 'object' && (v as any)._type === 'increment';

              if (isInc(val)) {
                if (isInc(existingVal)) {
                  existingVal.value += (val as any).value;
                } else if (typeof existingVal === 'number') {
                  targetOp.values[key] = existingVal + (val as any).value;
                } else {
                  targetOp.values[key] = { ...(val as any) }; // Clone increment
                }
              } else {
                targetOp.values[key] = val; // Raw value overrides previous state
              }
            }
            // Recalculate hasIncrements
            targetOp.hasIncrements = Object.values(targetOp.values).some(
              (v: any) => v && typeof v === 'object' && v._type === 'increment'
            );
            continue;
          }
        } else {
          updateCache.set(op.dedupKey, coalescedOps.length);
        }
      } else if (op.type === 'insert') {
        const tablePks = PRIMARY_KEYS[op.table as string] || ['id'];
        const opVals = op.values as Record<string, unknown> | undefined;
        if (opVals) {
          const hasAllPks = tablePks.every(pk => opVals[pk] !== undefined);
          if (hasAllPks) {
            const pkVals = tablePks.map(pk => String(opVals[pk]));
            const insertKey = `${op.table as string}:${pkVals.join('::')}`;
            const existingIdx = insertCache.get(insertKey);
            if (existingIdx !== undefined) {
              coalescedOps[existingIdx] = op;
              continue;
            } else {
              insertCache.set(insertKey, coalescedOps.length);
            }
          }
        }
      }
      coalescedOps.push(op);
    }

    const groups: WriteOp[][] = [];
    let currentGroup: WriteOp[] = [];
    for (const op of coalescedOps) {
      if (op.type === 'insert' && op.values) {
        if (
          currentGroup.length > 0 &&
          currentGroup[0]?.table === op.table &&
          currentGroup[0]?.type === 'insert'
        ) {
          currentGroup.push(op);
        } else {
          if (currentGroup.length > 0) groups.push(currentGroup);
          currentGroup = [op];
        }
      } else {
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [];
        groups.push([op]);
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }

  private async executeChunkedRawInsert(table: keyof Schema, group: WriteOp[]): Promise<number> {
    if (group.length === 0 || !this.rawDb) return 0;
    const firstOp = group[0];
    if (!firstOp?.values) return 0;

    const columns = Object.keys(firstOp.values);
    const CHUNK_SIZE = 100; // Optimal for SQLite param limits and SQL length

    let totalFlushed = 0;
    for (let i = 0; i < group.length; i += CHUNK_SIZE) {
      const chunk = group.slice(i, i + CHUNK_SIZE);
      const valuePlaceholders = `(${columns.map(() => '?').join(',')})`;
      const placeholders = chunk.map(() => valuePlaceholders).join(',');
      const sqlStr = `INSERT INTO ${table as string} (${columns.join(',')}) VALUES ${placeholders}`;

      const stmt = this.getStatement(sqlStr);

      // Level 4 Optimization: Zero-Allocation Parameter Flattening
      // Reuse the pre-allocated parameterBuffer to avoid GC pressure for 1M+ ops
      let pIdx = 0;
      for (const op of chunk) {
        const vals = op.values as Record<string, any>;
        for (const col of columns) {
          this.parameterBuffer[pIdx++] = vals[col];
        }
      }

      const params = this.parameterBuffer.slice(0, pIdx);
      try {
        stmt.run(...params);
      } finally {
        this.parameterBuffer.fill(undefined, 0, pIdx);
      }
      totalFlushed += chunk.length;
    }

    return totalFlushed;
  }

  private async executeBulkInsert(
    trx: Transaction<Schema>,
    table: keyof Schema,
    group: WriteOp[]
  ): Promise<number> {
    const firstOp = group[0];
    if (!firstOp?.values) return 0;
    const columnCount = Object.keys(firstOp.values).length || 1;
    const CHUNK_SIZE = Math.max(1, Math.floor(5000 / columnCount));
    let flushed = 0;
    for (let i = 0; i < group.length; i += CHUNK_SIZE) {
      const chunk = group.slice(i, i + CHUNK_SIZE);
      const values = chunk
        .map((op) => op.values)
        .filter((v): v is Record<string, unknown> => v !== undefined);
      await trx
        .insertInto(table)
        .values(values as never)
        .execute();
      flushed += chunk.length;
    }
    return flushed;
  }

  private isIncrement(value: unknown): value is Increment {
    return (
      typeof value === 'object' &&
      value !== null &&
      '_type' in value &&
      (value as Increment)._type === 'increment'
    );
  }

  private async executeSingleOp(trx: Transaction<Schema>, op: WriteOp) {
    const conditions = normalizeWhere(op.where);
    if (op.type === 'insert' && op.values) {
      await trx
        .insertInto(op.table)
        .values(op.values as any)
        .execute();
    } else if (op.type === 'upsert' && op.values) {
      const insertValues: Record<string, any> = {};
      for (const [k, v] of Object.entries(op.values)) {
        if (this.isIncrement(v)) {
          insertValues[k] = v.value;
        } else {
          insertValues[k] = v;
        }
      }

      const updateValues: Record<string, any> = {};
      for (const [k, v] of Object.entries(op.values)) {
        if (this.isIncrement(v)) {
          updateValues[k] = sql`${sql.ref(k)} + ${v.value}`;
        } else {
          updateValues[k] = v;
        }
      }

      let query = trx.insertInto(op.table).values(insertValues as any);
      if (op.conflictTarget) {
        query = (query as any).onConflict((oc: any) =>
          oc
            .columns(Array.isArray(op.conflictTarget) ? op.conflictTarget : [op.conflictTarget])
            .doUpdateSet(updateValues)
        );
      } else if (op.where && !Array.isArray(op.where)) {
        query = (query as any).onConflict((oc: any) =>
          oc.column((op.where as WhereCondition).column).doUpdateSet(updateValues)
        );
      } else if (op.where && Array.isArray(op.where)) {
        const cols = op.where.map((c) => c.column);
        query = (query as any).onConflict((oc: any) => oc.columns(cols).doUpdateSet(updateValues));
      } else {
        const pks = PRIMARY_KEYS[op.table as string] || ['id'];
        query = (query as any).onConflict((oc: any) => oc.columns(pks).doUpdateSet(updateValues));
      }
      await query.execute();
    } else if (op.type === 'update' && op.values) {
      const sets: Record<string, any> = {};
      for (const [k, v] of Object.entries(op.values)) {
        if (this.isIncrement(v)) {
          sets[k] = sql`${sql.ref(k)} + ${v.value}`;
        } else {
          sets[k] = v;
        }
      }

      const arrayCondIdx = conditions.findIndex(c => Array.isArray(c.value) && c.value.length > 500);
      if (arrayCondIdx >= 0) {
        const cond = conditions[arrayCondIdx];
        const arrayVal = cond.value as unknown[];
        const CHUNK_SIZE = 500;
        let totalUpdated = 0;
        for (let i = 0; i < arrayVal.length; i += CHUNK_SIZE) {
          const chunk = arrayVal.slice(i, i + CHUNK_SIZE);
          let query = trx.updateTable(op.table as any).set(sets);
          for (let j = 0; j < conditions.length; j++) {
            const c = conditions[j];
            if (j === arrayCondIdx) {
              query = (query as any).where(c.column, 'in', chunk);
            } else {
              const opStr = c.operator || '=';
              if (Array.isArray(c.value)) {
                query = (query as any).where(c.column, 'in', c.value);
              } else {
                query = (query as any).where(c.column, opStr, c.value);
              }
            }
          }
          const result = await query.executeTakeFirst();
          totalUpdated += Number(result.numUpdatedRows || 0);
        }
        if (totalUpdated === 0) {
          console.warn(
            `[DbPool] ⚠️ Update on ${op.table} matched 0 rows. Where: ${JSON.stringify(op.where)}`
          );
        }
      } else {
        let query = trx.updateTable(op.table as any).set(sets);
        for (const cond of conditions) {
          const opStr = cond.operator || '=';
          if (Array.isArray(cond.value)) {
            query = (query as any).where(cond.column, 'in', cond.value);
          } else {
            query = (query as any).where(cond.column, opStr, cond.value);
          }
        }
        const result = await query.executeTakeFirst();
        if (Number(result.numUpdatedRows) === 0) {
          console.warn(
            `[DbPool] ⚠️ Update on ${op.table} matched 0 rows. Where: ${JSON.stringify(op.where)}`
          );
        }
      }
    } else if (op.type === 'delete') {
      const arrayCondIdx = conditions.findIndex(c => Array.isArray(c.value) && c.value.length > 500);
      if (arrayCondIdx >= 0) {
        const cond = conditions[arrayCondIdx];
        const arrayVal = cond.value as unknown[];
        const CHUNK_SIZE = 500;
        let totalDeleted = 0;
        for (let i = 0; i < arrayVal.length; i += CHUNK_SIZE) {
          const chunk = arrayVal.slice(i, i + CHUNK_SIZE);
          let query = trx.deleteFrom(op.table);
          for (let j = 0; j < conditions.length; j++) {
            const c = conditions[j];
            if (j === arrayCondIdx) {
              query = (query as any).where(c.column, 'in', chunk);
            } else {
              const opStr = c.operator || '=';
              if (Array.isArray(c.value)) {
                query = (query as any).where(c.column, 'in', c.value);
              } else {
                query = (query as any).where(c.column, opStr, c.value);
              }
            }
          }
          const result = await query.executeTakeFirst();
          totalDeleted += Number(result.numDeletedRows || 0);
        }
        if (totalDeleted === 0) {
          console.warn(
            `[DbPool] ⚠️ Delete on ${op.table} matched 0 rows. Where: ${JSON.stringify(op.where)}`
          );
        }
      } else {
        let query = trx.deleteFrom(op.table);
        for (const cond of conditions) {
          const opStr = cond.operator || '=';
          if (Array.isArray(cond.value)) {
            query = (query as any).where(cond.column, 'in', cond.value);
          } else {
            query = (query as any).where(cond.column, opStr, cond.value);
          }
        }
        const result = await query.executeTakeFirst();
        if (Number(result.numDeletedRows) === 0) {
          console.warn(
            `[DbPool] ⚠️ Delete on ${op.table} matched 0 rows. Where: ${JSON.stringify(op.where)}`
          );
        }
      }
    }
  }

  private async checkpointWalIfNeeded(): Promise<void> {
    const db = this.requireDb('checkpointWalIfNeeded', true);
    const walPath = `${getDbPath()}-wal`;
    try {
      const stats = fs.statSync(walPath);
      if (stats.size > WAL_TRUNCATE_THRESHOLD_BYTES) {
        await sql`PRAGMA wal_checkpoint(TRUNCATE);`.execute(db);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        Logger.warn(`[DbPool] WAL checkpoint inspection failed: ${error.message || error}`);
      }
    }
  }

  public getMetrics() {
    return {
      lifecycleState: this.lifecycleState,
      activeBuffer: this.activeBuffer === this.bufferA ? 'A' : 'B',
      activeBufferSize: this.activeBufferSize,
      inFlightOpsSize: this.inFlightSize,
      pendingWriteCount: this.getPendingWriteCount(),
      activeShadows: this.agentShadows.size,
      totalTransactions: this.totalTransactions,
      lastSuccessfulFlush: this.lastSuccessfulFlush,
      lastFlushLatency: this.lastFlushLatency,
      failedWriteCount: this.failedWriteCount,
      lockContentionCount: this.lockContentionCount,
      latencies: {
        enqueue: {
          p95: this.calculatePercentile(this.enqueueLatencies, 95),
          p99: this.calculatePercentile(this.enqueueLatencies, 99),
        },
        processing: {
          p95: this.calculatePercentile(this.processingLatencies, 95),
          p99: this.calculatePercentile(this.processingLatencies, 99),
        },
      },
      integrity: { ...this.integrityMetrics },
    };
  }

  public async health(): Promise<ServiceHealth> {
    const metrics = this.getMetrics();
    const lifecycle =
      this.lifecycleState === 'started'
        ? 'started'
        : this.lifecycleState === 'stopped'
          ? 'stopped'
          : 'new';

    return lifecycleHealth('db', lifecycle, {
      metrics: {
        dbPath: getDbPath(),
        pendingWriteCount: metrics.pendingWriteCount,
        activeBufferSize: metrics.activeBufferSize,
        inFlightOpsSize: metrics.inFlightOpsSize,
      },
    });
  }

  public reportIntegrityIssue(type: 'brokenImport' | 'orphanedNode', count: number = 1) {
    if (type === 'brokenImport') this.integrityMetrics.brokenImports += count;
    if (type === 'orphanedNode') this.integrityMetrics.orphanedNodes += count;
  }

  private addStatusIndex(op: WriteOp, indexMap: Map<keyof Schema, Map<string, Set<WriteOp>>>) {
    const cols = INDEXED_COLUMNS[op.table as string];
    if (!cols || !op.values) return;

    for (const col of cols) {
      const val = (op.values as any)[col];
      if (val !== undefined && val !== null) {
        let tableIndex = indexMap.get(op.table);
        if (!tableIndex) {
          tableIndex = new Map();
          indexMap.set(op.table, tableIndex);
        }
        const key = `${col}:${val}`;
        let set = tableIndex.get(key);
        if (!set) {
          set = new Set();
          tableIndex.set(key, set);
        }
        set.add(op);
      }
    }
  }

  private isSameValues(a: Record<string, any>, b: Record<string, any>): boolean {
    if (a === b) return true;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) {
        // Handle Increment objects specifically
        const valA = a[key];
        const valB = b[key];
        if (this.isIncrement(valA) && this.isIncrement(valB)) {
          if (valA.value !== valB.value) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Level 9: Sovereign Recovery (Warmup)
   * Populates the in-memory Level 7 indexes from the Level 2 Checkpoint (Disk).
   * This ensures the "Brain" wakes up at full speed after a reboot.
   */
  public async warmupTable<T extends keyof Schema>(
    table: T,
    statusCol: string,
    statusValue: string
  ): Promise<number> {
    const db = await this.ensureDb();
    const rows = await db
      .selectFrom(table as any)
      .where(statusCol as any, '=', statusValue as any)
      .selectAll()
      .execute();

    if (rows.length === 0) return 0;

    let tableIndex = this.activeIndex.get(table as any);
    if (!tableIndex) {
      tableIndex = new Map();
      this.activeIndex.set(table as any, tableIndex);
    }

    const key = `${statusCol}:${statusValue}`;
    let set = tableIndex.get(key);
    if (!set) {
      set = new Set();
      tableIndex.set(key, set);
    }

    // Convert disk rows into a "Virtual WriteOp" to satisfy Level 1 Select logic
    for (const row of rows) {
      const op: WriteOp = {
        type: 'insert',
        table: table as any,
        values: row as any,
        hasIncrements: false,
      };
      set.add(op);
    }

    // Level 9: Mark as Authoritative
    this.warmedIndices.add(`${table as string}:${statusCol}:${statusValue}`);

    return rows.length;
  }

  private async drainBufferedWrites(): Promise<void> {
    for (let pass = 0; pass < 5; pass++) {
      if (this.getDurableFlushableWriteCount() === 0 && !this.activeFlushPromise) return;
      await this.requestFlush(true);
    }
    if (this.getDurableFlushableWriteCount() > 0) {
      throw new FlushTimeoutError(
        `BufferedDbPool.stop() could not drain ${this.getDurableFlushableWriteCount()} writes.`
      );
    }
  }

  public async stop(): Promise<void> {
    if (this.lifecycleState === 'stopped') return;
    if (this.lifecycleState === 'new') {
      this.lifecycleState = 'stopped';
      return;
    }
    if (this.lifecycleState === 'starting' && this.startPromise) {
      await this.startPromise;
    }

    this.lifecycleState = 'stopping';

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    this.currentFlushDelay = null;

    try {
      await this.drainBufferedWrites();
    } finally {
      for (const stmt of this.stmtCache.values()) {
        try {
          (stmt as { dispose?: () => void })?.dispose?.();
        } catch {}
      }
      this.stmtCache.clear();
      this.parameterBuffer.fill(undefined);
      this.db = null;
      this.rawDb = null;
      this.activeFlushPromise = null;
      this.pendingFlushPromise = null;
      await destroyDb();
      this.lifecycleState = 'stopped';
    }
  }

  public selectFrom<T extends keyof Schema>(table: T): QueryBuilder<T> {
    return new QueryBuilder(this, table);
  }

  public insertInto<T extends keyof Schema>(table: T): InsertBuilder<T> {
    return new InsertBuilder(this, table);
  }

  public updateTable<T extends keyof Schema>(table: T): UpdateBuilder<T> {
    return new UpdateBuilder(this, table);
  }

  public deleteFrom<T extends keyof Schema>(table: T): DeleteBuilder<T> {
    return new DeleteBuilder(this, table);
  }
}

export const dbPool = new BufferedDbPool();

export class QueryBuilder<T extends keyof Schema> {
  private conditions: WhereCondition[] = [];
  private order?: { column: keyof Schema[T]; direction: 'asc' | 'desc' };
  private lim?: number;

  constructor(private pool: BufferedDbPool, private table: T) {}

  where(column: keyof Schema[T] & string, value: any): this;
  where(column: keyof Schema[T] & string, operator: WhereCondition['operator'], value: any): this;
  where(column: keyof Schema[T] & string, operatorOrValue: any, value?: any): this {
    if (value === undefined) {
      this.conditions.push({ column, value: operatorOrValue });
    } else {
      this.conditions.push({ column, operator: operatorOrValue, value });
    }
    return this;
  }

  orderBy(column: keyof Schema[T], direction: 'asc' | 'desc' = 'asc'): this {
    this.order = { column, direction };
    return this;
  }

  limit(limit: number): this {
    this.lim = limit;
    return this;
  }

  async execute(agentId?: string): Promise<Schema[T][]> {
    return this.pool.selectWhere(this.table, this.conditions, agentId, {
      orderBy: this.order as any,
      limit: this.lim,
    });
  }

  async executeTakeFirst(agentId?: string): Promise<Schema[T] | null> {
    const results = await this.execute(agentId);
    return results.length > 0 ? (results[0] as Schema[T]) : null;
  }
}

export class InsertBuilder<T extends keyof Schema> {
  private valuesToInsert?: Record<string, unknown> | Record<string, unknown>[];
  private conflictTargetCol?: string | string[];

  constructor(private pool: BufferedDbPool, private table: T) {}

  values(val: Partial<Schema[T]> | Partial<Schema[T]>[]): this {
    this.valuesToInsert = val as any;
    return this;
  }

  onConflict(target: string | string[]): this {
    this.conflictTargetCol = target;
    return this;
  }

  async execute(agentId?: string, affectedFile?: string): Promise<void> {
    if (!this.valuesToInsert) return;

    if (Array.isArray(this.valuesToInsert)) {
      const ops = this.valuesToInsert.map(v => ({
        type: 'insert' as const,
        table: this.table,
        values: v,
        agentId,
      }));
      await this.pool.pushBatch(ops, agentId, affectedFile);
    } else {
      const op: WriteOp = {
        type: this.conflictTargetCol ? 'upsert' : 'insert',
        table: this.table,
        values: this.valuesToInsert,
        conflictTarget: this.conflictTargetCol,
        agentId,
      };
      await this.pool.push(op, agentId, affectedFile);
    }
  }
}

export class UpdateBuilder<T extends keyof Schema> {
  private setValues?: Record<string, unknown>;
  private conditions: WhereCondition[] = [];

  constructor(private pool: BufferedDbPool, private table: T) {}

  set(val: Partial<Schema[T]> | Record<string, unknown>): this {
    this.setValues = val as any;
    return this;
  }

  where(column: keyof Schema[T] & string, value: any): this;
  where(column: keyof Schema[T] & string, operator: WhereCondition['operator'], value: any): this;
  where(column: keyof Schema[T] & string, operatorOrValue: any, value?: any): this {
    if (value === undefined) {
      this.conditions.push({ column, value: operatorOrValue });
    } else {
      this.conditions.push({ column, operator: operatorOrValue, value });
    }
    return this;
  }

  async execute(agentId?: string, affectedFile?: string): Promise<void> {
    if (!this.setValues) return;
    const op: WriteOp = {
      type: 'update',
      table: this.table,
      values: this.setValues,
      where: this.conditions,
      agentId,
    };
    await this.pool.push(op, agentId, affectedFile);
  }
}

export class DeleteBuilder<T extends keyof Schema> {
  private conditions: WhereCondition[] = [];

  constructor(private pool: BufferedDbPool, private table: T) {}

  where(column: keyof Schema[T] & string, value: any): this;
  where(column: keyof Schema[T] & string, operator: WhereCondition['operator'], value: any): this;
  where(column: keyof Schema[T] & string, operatorOrValue: any, value?: any): this {
    if (value === undefined) {
      this.conditions.push({ column, value: operatorOrValue });
    } else {
      this.conditions.push({ column, operator: operatorOrValue, value });
    }
    return this;
  }

  async execute(agentId?: string, affectedFile?: string): Promise<void> {
    const op: WriteOp = {
      type: 'delete',
      table: this.table,
      where: this.conditions,
      agentId,
    };
    await this.pool.push(op, agentId, affectedFile);
  }
}
