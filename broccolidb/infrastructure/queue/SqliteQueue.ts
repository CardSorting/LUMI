// [LAYER: INFRASTRUCTURE]
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BufferedDbPool, dbPool } from '../db/BufferedDbPool.js';
import { getDb } from '../db/Config.js';
import { Kysely, SqliteDialect, sql } from 'kysely';

class SimpleMutex {
  private promise: Promise<void> = Promise.resolve();
  async runLocked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.promise.then(fn);
    this.promise = next.then(() => {}, () => {});
    return next;
  }
}

export interface QueueJob<T> {
  id: string;
  payload: T;
  status: 'pending' | 'processing' | 'done' | 'failed';
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  error?: string | null;
  progress?: number;
  metadata?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type JobHandler<T> = (job: QueueJobInstance<T>) => Promise<void>;
export type BatchJobHandler<T> = (jobs: QueueJobInstance<T>[]) => Promise<void>;

export interface SqliteQueueOptions {
  dbPath?: string;
  tableName?: string;
  visibilityTimeoutMs?: number;
  pruneDoneAgeMs?: number;
  defaultMaxAttempts?: number;
  baseRetryDelayMs?: number;
  memoryFirst?: boolean;
}

export class QueueJobInstance<T> implements QueueJob<T> {
  public readonly id: string;
  public readonly payload: T;
  public readonly status: 'pending' | 'processing' | 'done' | 'failed';
  public readonly priority: number;
  public readonly attempts: number;
  public readonly maxAttempts: number;
  public readonly runAt: number;
  public readonly error?: string | null;
  public readonly progress?: number;
  public readonly metadata?: string | null;
  public readonly createdAt: number;
  public readonly updatedAt: number;

  private queue: SqliteQueue<T>;
  public signal?: AbortSignal;

  constructor(job: QueueJob<T>, queue: SqliteQueue<T>, signal?: AbortSignal) {
    this.id = job.id;
    this.payload = job.payload;
    this.status = job.status;
    this.priority = job.priority;
    this.attempts = job.attempts;
    this.maxAttempts = job.maxAttempts;
    this.runAt = job.runAt;
    this.error = job.error;
    this.progress = job.progress ?? 0;
    this.metadata = job.metadata;
    this.createdAt = job.createdAt;
    this.updatedAt = job.updatedAt;
    this.queue = queue;
    this.signal = signal;
  }

  async complete(): Promise<void> {
    await this.queue.complete(this.id);
  }

  async fail(error: string): Promise<void> {
    await this.queue.fail(this.id, error);
  }

  async updateProgress(percent: number, meta?: any): Promise<void> {
    await this.queue.updateProgress(this.id, percent, meta);
  }

  async heartbeat(): Promise<void> {
    await this.queue.heartbeat(this.id);
  }

  async log(message: string): Promise<void> {
    await this.queue.logJobMessage(this.id, message);
  }
}

/**
 * SqliteQueue provides a hardened, production-grade background job processor.
 * Optimized for agent workflows, dynamic DB separation, and safe concurrent processing.
 */
export class SqliteQueue<T> {
  private isProcessing = false;
  private stopRequested = false;
  private wakeUpEmitter = new EventEmitter();

  private pendingMemoryBuffer: (QueueJob<T> | null)[] = new Array(1000000).fill(null);
  private bufferHead = 0;
  private bufferTail = 0;
  private maxMemoryBufferSize = 1000000;

  private dbPath?: string;
  private tableName: string;
  private visibilityTimeoutMs: number;
  private pruneDoneAgeMs: number;
  private defaultMaxAttempts: number;
  private baseRetryDelayMs: number;
  private memoryFirst: boolean;

  private initialized = false;
  private db: Kysely<any> | null = null;
  private privateConnection = false;
  private initMutex = new SimpleMutex();
  private activeControllers = new Set<AbortController>();

  private bufferSize(): number {
    return (
      (this.bufferTail - this.bufferHead + this.maxMemoryBufferSize) % this.maxMemoryBufferSize
    );
  }

  private pushToMemoryBuffer(job: QueueJob<T>) {
    if (this.bufferSize() < this.maxMemoryBufferSize - 1) {
      this.pendingMemoryBuffer[this.bufferTail] = job;
      this.bufferTail = (this.bufferTail + 1) % this.maxMemoryBufferSize;
    }
  }

  constructor(options: SqliteQueueOptions = {}) {
    const {
      dbPath,
      tableName = 'queue_jobs',
      visibilityTimeoutMs = 300000, // 5 minutes default
      pruneDoneAgeMs = 86400000, // 24 hours default
      defaultMaxAttempts = 5,
      baseRetryDelayMs = 1000,
      memoryFirst = false,
    } = options;

    this.dbPath = dbPath;
    this.tableName = tableName;
    this.visibilityTimeoutMs = visibilityTimeoutMs;
    this.pruneDoneAgeMs = pruneDoneAgeMs;
    this.defaultMaxAttempts = defaultMaxAttempts;
    this.baseRetryDelayMs = baseRetryDelayMs;
    this.memoryFirst = memoryFirst;
    this.wakeUpEmitter.setMaxListeners(100);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.initMutex.runLocked(async () => {
      if (this.initialized) return;

      if (this.dbPath) {
        const DatabaseConstructor = (await import('better-sqlite3')).default;
        const rawDb = new DatabaseConstructor(this.dbPath);

        rawDb.pragma('journal_mode = WAL');
        rawDb.pragma('synchronous = NORMAL');
        rawDb.pragma('foreign_keys = ON');
        rawDb.pragma('cache_size = -128000');
        rawDb.pragma('temp_store = MEMORY');

        this.db = new Kysely<any>({
          dialect: new SqliteDialect({
            database: rawDb,
          }),
        });
        this.privateConnection = true;
      } else {
        this.db = await getDb();
      }

      // 1. Create table if not exists
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.table(this.tableName)} (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          attempts INTEGER DEFAULT 0,
          maxAttempts INTEGER DEFAULT 5,
          runAt BIGINT,
          error TEXT,
          progress INTEGER DEFAULT 0,
          metadata TEXT,
          workerId TEXT,
          createdAt BIGINT,
          updatedAt BIGINT
        )
      `.execute(this.db);

      // 2. Ensure indices
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.raw(this.tableName + '_idx_poll')} ON ${sql.table(this.tableName)}(status, runAt, priority DESC, createdAt ASC)
      `.execute(this.db);
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.raw(this.tableName + '_idx_cleanup')} ON ${sql.table(this.tableName)}(status, updatedAt)
      `.execute(this.db);

      // 3. Auto-patch columns if they are missing
      const tableInfo = await sql<any>`PRAGMA table_info(${sql.table(this.tableName)})`.execute(this.db);
      const columns = tableInfo.rows.map((r: any) => r.name);

      if (!columns.includes('progress')) {
        await sql`ALTER TABLE ${sql.table(this.tableName)} ADD COLUMN progress INTEGER DEFAULT 0`.execute(this.db).catch(() => {});
      }
      if (!columns.includes('metadata')) {
        await sql`ALTER TABLE ${sql.table(this.tableName)} ADD COLUMN metadata TEXT`.execute(this.db).catch(() => {});
      }
      if (!columns.includes('workerId')) {
        await sql`ALTER TABLE ${sql.table(this.tableName)} ADD COLUMN workerId TEXT`.execute(this.db).catch(() => {});
      }

      this.initialized = true;
    });
  }

  /**
   * Enqueue a new job with optional priority and delay.
   */
  async enqueue(
    payload: T,
    options: {
      id?: string;
      priority?: number;
      delayMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<string> {
    await this.ensureInitialized();
    const jobId = options.id || crypto.randomUUID();
    const now = Date.now();
    const runAt = now + (options.delayMs || 0);
    const maxAttempts = options.maxAttempts ?? this.defaultMaxAttempts;

    const values = {
      id: jobId,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      status: 'pending' as const,
      priority: options.priority || 0,
      attempts: 0,
      maxAttempts,
      runAt,
      createdAt: now,
      updatedAt: now,
      error: null,
      progress: 0,
      metadata: null,
      workerId: null,
    };

    if (this.memoryFirst) {
      await dbPool.push({
        type: 'upsert',
        table: 'queue_jobs',
        values: values as any,
        where: { column: 'id', value: jobId },
        layer: 'infrastructure',
      });

      if (runAt <= now) {
        this.pushToMemoryBuffer({
          ...values,
          payload: payload as T,
        } as unknown as QueueJob<T>);
      }
    } else {
      await this.db!
        .insertInto(this.tableName as any)
        .values(values as any)
        .onConflict((oc) => oc.column('id').doUpdateSet(values as any))
        .execute();
    }

    this.wakeUpEmitter.emit('enqueue');
    return jobId;
  }

  /**
   * Enqueue multiple jobs in a single transaction for high throughput.
   */
  async enqueueBatch(
    items: { payload: T; priority?: number; delayMs?: number; id?: string }[]
  ): Promise<string[]> {
    await this.ensureInitialized();
    const ids: string[] = [];
    const now = Date.now();

    const insertValues = items.map((item) => {
      const jobId = item.id || crypto.randomUUID();
      const runAt = now + (item.delayMs || 0);
      ids.push(jobId);

      const values = {
        id: jobId,
        payload: typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload),
        status: 'pending' as const,
        priority: item.priority || 0,
        attempts: 0,
        maxAttempts: this.defaultMaxAttempts,
        runAt,
        createdAt: now,
        updatedAt: now,
        error: null,
        progress: 0,
        metadata: null,
        workerId: null,
      };

      if (this.memoryFirst && runAt <= now) {
        this.pushToMemoryBuffer({
          ...values,
          payload: item.payload as T,
        } as unknown as QueueJob<T>);
      }

      return values;
    });

    if (insertValues.length === 0) return [];

    if (this.memoryFirst) {
      const ops = insertValues.map((values) => ({
        type: 'insert' as const,
        table: 'queue_jobs' as const,
        values,
        layer: 'infrastructure' as const,
      }));
      await dbPool.pushBatch(ops);
    } else {
      const chunkSize = 500;
      for (let i = 0; i < insertValues.length; i += chunkSize) {
        const chunk = insertValues.slice(i, i + chunkSize);
        await this.db!
          .insertInto(this.tableName as any)
          .values(chunk as any)
          .execute();
      }
    }

    this.wakeUpEmitter.emit('enqueue');
    return ids;
  }

  /**
   * Dequeue multiple jobs atomically using a transaction.
   * Prioritizes Memory-First buffer over DB polling.
   */
  async dequeueBatch(limit: number): Promise<QueueJobInstance<T>[]> {
    await this.ensureInitialized();

    if (this.memoryFirst) {
      const memoryJobsCount = this.bufferSize();
      if (memoryJobsCount > 0) {
        const actualLimit = Math.min(limit, memoryJobsCount);
        const jobs: QueueJob<T>[] = [];

        for (let i = 0; i < actualLimit; i++) {
          const job = this.pendingMemoryBuffer[this.bufferHead];
          if (job) jobs.push(job);
          this.pendingMemoryBuffer[this.bufferHead] = null;
          this.bufferHead = (this.bufferHead + 1) % this.maxMemoryBufferSize;
        }

        const ids = jobs.map((j) => j.id);
        const nowMs = Date.now();

        dbPool
          .push({
            type: 'update',
            table: 'queue_jobs',
            values: {
              status: 'processing',
              updatedAt: nowMs,
              attempts: BufferedDbPool.increment(1),
            },
            where: { column: 'id', value: ids, operator: 'IN' },
            layer: 'infrastructure',
          })
          .catch((err) => console.error('[SqliteQueue] Background status update failed:', err));

        return jobs.map((job) => {
          const rawJob = {
            ...job,
            status: 'processing' as const,
            updatedAt: nowMs,
            attempts: job.attempts + 1,
          };
          return new QueueJobInstance(rawJob, this);
        });
      }

      const now = Date.now();
      try {
        return await dbPool.runTransaction(async (agentId) => {
          const jobs = await dbPool.selectWhere(
            'queue_jobs',
            [
              { column: 'status', value: 'pending' },
              { column: 'runAt', value: now, operator: '<=' },
            ],
            agentId,
            {
              orderBy: { column: 'priority', direction: 'desc' },
              limit: limit * 2,
            }
          );

          if (jobs.length === 0) return [];

          const nowMs = Date.now();

          const mappedJobs = jobs.map((job) => ({
            ...job,
            payload:
              typeof job.payload === 'string' &&
              (job.payload.startsWith('{') || job.payload.startsWith('['))
                ? (JSON.parse(job.payload) as T)
                : (job.payload as T),
            updatedAt: nowMs,
            attempts: job.attempts + 1,
            status: 'processing' as const,
          })) as unknown as QueueJob<T>[];

          const toBuffer = mappedJobs.slice(limit);
          const allIds = jobs.map((j) => j.id);

          await dbPool.push(
            {
              type: 'update',
              table: 'queue_jobs',
              values: {
                status: 'processing',
                updatedAt: nowMs,
                attempts: BufferedDbPool.increment(1),
              },
              where: { column: 'id', value: allIds, operator: 'IN' },
              layer: 'infrastructure',
            },
            agentId
          );

          if (toBuffer.length > 0) {
            for (const job of toBuffer) {
              this.pushToMemoryBuffer(job);
            }
          }

          return mappedJobs.slice(0, limit).map((job) => new QueueJobInstance(job, this));
        });
      } catch (e) {
        console.error('[SqliteQueue] DequeueBatch failed (memoryFirst):', e);
        return [];
      }
    }

    // --- Safe, Transactional DB Dequeue (Default) ---
    const nowMs = Date.now();
    const dequeueToken = crypto.randomUUID();

    try {
      await sql`
        UPDATE ${sql.table(this.tableName)}
        SET status = 'processing',
            updatedAt = ${nowMs},
            attempts = attempts + 1,
            workerId = ${dequeueToken}
        WHERE id IN (
          SELECT id FROM ${sql.table(this.tableName)}
          WHERE status = 'pending' AND runAt <= ${nowMs}
          ORDER BY priority DESC, createdAt ASC
          LIMIT ${limit}
        )
      `.execute(this.db!);

      const rows = await this.db!
        .selectFrom(this.tableName as any)
        .selectAll()
        .where('workerId', '=', dequeueToken)
        .execute();

      return rows.map((row: any) => {
        const payload =
          typeof row.payload === 'string' &&
          (row.payload.startsWith('{') || row.payload.startsWith('['))
            ? JSON.parse(row.payload)
            : row.payload;

        const job: QueueJob<T> = {
          id: row.id,
          payload,
          status: row.status,
          priority: Number(row.priority),
          attempts: Number(row.attempts),
          maxAttempts: Number(row.maxAttempts),
          runAt: Number(row.runAt),
          error: row.error,
          progress: Number(row.progress || 0),
          metadata: row.metadata,
          createdAt: Number(row.createdAt),
          updatedAt: Number(row.updatedAt),
        };

        return new QueueJobInstance(job, this);
      });
    } catch (e) {
      console.error('[SqliteQueue] DequeueBatch failed:', e);
      return [];
    }
  }

  /**
   * Recovers jobs that were stuck in 'processing' (e.g., process crashed).
   */
  async reclaimStaleJobs(): Promise<number> {
    const now = Date.now();
    const threshold = now - this.visibilityTimeoutMs;

    let count = 0;
    if (this.memoryFirst) {
      const staleJobs = await dbPool.selectWhere('queue_jobs', [
        { column: 'status', value: 'processing' },
        { column: 'updatedAt', value: threshold, operator: '<' },
      ]);

      if (staleJobs.length === 0) return 0;
      count = staleJobs.length;

      const nowMs = Date.now();
      await dbPool.pushBatch(
        staleJobs.map((job) => ({
          type: 'update',
          table: 'queue_jobs',
          values: { status: 'pending', updatedAt: nowMs },
          where: { column: 'id', value: job.id },
          layer: 'infrastructure',
        }))
      );
    } else {
      const result = await this.db!
        .updateTable(this.tableName as any)
        .set({ status: 'pending', updatedAt: now } as any)
        .where('status', '=', 'processing')
        .where('updatedAt', '<', threshold)
        .executeTakeFirst();
      count = Number(result.numUpdatedRows || 0);
    }

    if (count > 0) {
      console.warn(`[SqliteQueue] Reclaiming ${count} stale jobs.`);
    }
    return count;
  }

  /**
   * Mark multiple jobs as completed in a single high-throughput update.
   */
  async completeBatch(ids: string[]) {
    if (ids.length === 0) return;
    await this.ensureInitialized();
    const now = Date.now();
    if (this.memoryFirst) {
      await dbPool.push({
        type: 'update',
        table: 'queue_jobs',
        values: { status: 'done', updatedAt: now },
        where: { column: 'id', value: ids, operator: 'IN' },
        layer: 'infrastructure',
      });
    } else {
      await this.db!
        .updateTable(this.tableName as any)
        .set({ status: 'done', updatedAt: now } as any)
        .where('id', 'in', ids)
        .execute();
    }
  }

  /**
   * Completed task handling.
   */
  async complete(id: string) {
    await this.ensureInitialized();
    const now = Date.now();
    if (this.memoryFirst) {
      await dbPool.push({
        type: 'update',
        table: 'queue_jobs',
        values: { status: 'done', updatedAt: now },
        where: { column: 'id', value: id },
        layer: 'infrastructure',
      });
    } else {
      await this.db!
        .updateTable(this.tableName as any)
        .set({ status: 'done', updatedAt: now } as any)
        .where('id', '=', id)
        .execute();
    }
  }

  /**
   * Failure handling with exponential backoff.
   */
  async fail(id: string, error: string) {
    await this.ensureInitialized();
    const now = Date.now();

    let job: any;
    if (this.memoryFirst) {
      job = await dbPool.selectOne('queue_jobs', { column: 'id', value: id });
    } else {
      job = await this.db!
        .selectFrom(this.tableName as any)
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    }

    if (!job) return;

    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || this.defaultMaxAttempts);

    if (attempts < maxAttempts) {
      const nextDelay = Math.pow(2, attempts - 1) * this.baseRetryDelayMs;
      const nextRun = now + nextDelay;

      if (this.memoryFirst) {
        await dbPool.push({
          type: 'update',
          table: 'queue_jobs',
          values: { status: 'pending', runAt: nextRun, error, updatedAt: now },
          where: { column: 'id', value: id },
          layer: 'infrastructure',
        });
      } else {
        await this.db!
          .updateTable(this.tableName as any)
          .set({ status: 'pending', runAt: nextRun, error, updatedAt: now } as any)
          .where('id', '=', id)
          .execute();
      }

      console.warn(`[SqliteQueue] Job ${id} failed. Retrying in ${nextDelay}ms...`);
    } else {
      if (this.memoryFirst) {
        await dbPool.push({
          type: 'update',
          table: 'queue_jobs',
          values: { status: 'failed', error, updatedAt: now },
          where: { column: 'id', value: id },
          layer: 'infrastructure',
        });
      } else {
        await this.db!
          .updateTable(this.tableName as any)
          .set({ status: 'failed', error, updatedAt: now } as any)
          .where('id', '=', id)
          .execute();
      }

      console.error(`[SqliteQueue] Job ${id} failed permanently after ${attempts} attempts.`);
    }
  }

  /**
   * Heartbeat to extend job lock/visibility.
   */
  async heartbeat(id: string) {
    await this.ensureInitialized();
    const now = Date.now();
    if (this.memoryFirst) {
      await dbPool.push({
        type: 'update',
        table: 'queue_jobs',
        values: { updatedAt: now },
        where: { column: 'id', value: id },
        layer: 'infrastructure',
      });
    } else {
      await this.db!
        .updateTable(this.tableName as any)
        .set({ updatedAt: now } as any)
        .where('id', '=', id)
        .execute();
    }
  }

  /**
   * Update job progress percentage and generic metadata.
   */
  async updateProgress(id: string, percent: number, meta?: any) {
    await this.ensureInitialized();
    const now = Date.now();
    const metaStr = meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null;

    if (this.memoryFirst) {
      await dbPool.push({
        type: 'update',
        table: 'queue_jobs',
        values: { progress: percent, metadata: metaStr, updatedAt: now },
        where: { column: 'id', value: id },
        layer: 'infrastructure',
      });
    } else {
      await this.db!
        .updateTable(this.tableName as any)
        .set({ progress: percent, metadata: metaStr, updatedAt: now } as any)
        .where('id', '=', id)
        .execute();
    }
  }

  /**
   * Append a single trace execution log message to the job's metadata.
   */
  async logJobMessage(id: string, message: string) {
    await this.ensureInitialized();

    let job: any;
    if (this.memoryFirst) {
      job = await dbPool.selectOne('queue_jobs', { column: 'id', value: id });
    } else {
      job = await this.db!
        .selectFrom(this.tableName as any)
        .select(['metadata', 'progress'])
        .where('id', '=', id)
        .executeTakeFirst();
    }

    let logs: string[] = [];
    let currentMeta: Record<string, any> = {};

    if (job?.metadata) {
      try {
        const parsed = JSON.parse(job.metadata);
        if (parsed && typeof parsed === 'object') {
          currentMeta = parsed;
          if (Array.isArray(parsed.logs)) {
            logs = parsed.logs;
          }
        }
      } catch {
        // Not a JSON object
      }
    }

    logs.push(`[${new Date().toISOString()}] ${message}`);
    currentMeta.logs = logs;

    await this.updateProgress(id, job?.progress || 0, currentMeta);
  }

  /**
   * Get all permanently failed jobs.
   */
  async getFailedJobs(options: { limit?: number; offset?: number } = {}): Promise<QueueJob<T>[]> {
    await this.ensureInitialized();
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    let rows: any[];
    if (this.memoryFirst) {
      rows = await dbPool.selectWhere('queue_jobs', [
        { column: 'status', value: 'failed' }
      ]);
      rows = rows.slice(offset, offset + limit);
    } else {
      rows = await this.db!
        .selectFrom(this.tableName as any)
        .selectAll()
        .where('status', '=', 'failed')
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();
    }

    return rows.map((row) => ({
      id: row.id,
      payload: typeof row.payload === 'string' && (row.payload.startsWith('{') || row.payload.startsWith('['))
        ? JSON.parse(row.payload)
        : row.payload,
      status: row.status,
      priority: Number(row.priority),
      attempts: Number(row.attempts),
      maxAttempts: Number(row.maxAttempts),
      runAt: Number(row.runAt),
      error: row.error,
      progress: Number(row.progress || 0),
      metadata: row.metadata,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  /**
   * Resets a failed job to pending.
   */
  async retryJob(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const now = Date.now();

    let resultCount = 0;
    if (this.memoryFirst) {
      const job = await dbPool.selectOne('queue_jobs', { column: 'id', value: id });
      if (job && job.status === 'failed') {
        await dbPool.push({
          type: 'update',
          table: 'queue_jobs',
          values: { status: 'pending', attempts: 0, runAt: now, error: null, updatedAt: now },
          where: { column: 'id', value: id },
          layer: 'infrastructure',
        });
        resultCount = 1;
      }
    } else {
      const result = await this.db!
        .updateTable(this.tableName as any)
        .set({ status: 'pending', attempts: 0, runAt: now, error: null, updatedAt: now } as any)
        .where('id', '=', id)
        .where('status', '=', 'failed')
        .executeTakeFirst();
      resultCount = Number(result.numUpdatedRows || 0);
    }

    if (resultCount > 0) {
      this.wakeUpEmitter.emit('enqueue');
      return true;
    }
    return false;
  }

  /**
   * Replays all permanently failed jobs.
   */
  async retryAllFailed(): Promise<number> {
    await this.ensureInitialized();
    const now = Date.now();

    let count = 0;
    if (this.memoryFirst) {
      const failed = await dbPool.selectWhere('queue_jobs', { column: 'status', value: 'failed' });
      count = failed.length;
      if (count > 0) {
        const ids = failed.map((j) => j.id);
        await dbPool.push({
          type: 'update',
          table: 'queue_jobs',
          values: { status: 'pending', attempts: 0, runAt: now, error: null, updatedAt: now },
          where: { column: 'id', value: ids, operator: 'IN' },
          layer: 'infrastructure',
        });
      }
    } else {
      const result = await this.db!
        .updateTable(this.tableName as any)
        .set({ status: 'pending', attempts: 0, runAt: now, error: null, updatedAt: now } as any)
        .where('status', '=', 'failed')
        .executeTakeFirst();
      count = Number(result.numUpdatedRows || 0);
    }

    if (count > 0) {
      this.wakeUpEmitter.emit('enqueue');
    }
    return count;
  }

  /**
   * Permanently purges all failed jobs.
   */
  async purgeFailed(): Promise<number> {
    await this.ensureInitialized();

    let count = 0;
    if (this.memoryFirst) {
      const failed = await dbPool.selectWhere('queue_jobs', { column: 'status', value: 'failed' });
      count = failed.length;
      if (count > 0) {
        const ids = failed.map((j) => j.id);
        await dbPool.pushBatch(
          ids.map((id) => ({
            type: 'delete',
            table: 'queue_jobs',
            where: { column: 'id', value: id },
            layer: 'infrastructure',
          }))
        );
      }
    } else {
      const result = await this.db!
        .deleteFrom(this.tableName as any)
        .where('status', '=', 'failed')
        .executeTakeFirst();
      count = Number(result.numDeletedRows || 0);
    }
    return count;
  }

  /**
   * Health check and automated maintenance.
   */
  async performMaintenance(): Promise<void> {
    const now = Date.now();

    try {
      if (this.memoryFirst) {
        await dbPool.runTransaction(async (agentId) => {
          const lastMaint = await dbPool.selectOne(
            'queue_settings',
            { column: 'key', value: 'last_maintenance' },
            agentId
          );
          if (lastMaint && now - Number(lastMaint.value) < 10000) return;

          await dbPool.push(
            {
              type: 'upsert',
              table: 'queue_settings',
              values: { key: 'last_maintenance', value: String(now), updatedAt: now },
              where: { column: 'key', value: 'last_maintenance' },
              layer: 'infrastructure',
            },
            agentId
          );

          await this.reclaimStaleJobs();

          const pruneThreshold = now - this.pruneDoneAgeMs;
          const oldJobs = await dbPool.selectWhere(
            'queue_jobs',
            [
              { column: 'status', value: 'done' },
              { column: 'updatedAt', value: pruneThreshold, operator: '<' },
            ],
            agentId
          );

          if (oldJobs.length > 0) {
            await dbPool.pushBatch(
              oldJobs.map((j) => ({
                type: 'delete',
                table: 'queue_jobs',
                where: { column: 'id', value: j.id },
                layer: 'infrastructure',
              })),
              agentId
            );
            console.info(`[SqliteQueue] Pruned ${oldJobs.length} old completed jobs.`);
          }
        });
      } else {
        await this.db!.transaction().execute(async (trx) => {
          const settingsTable = `${this.tableName}_settings`;

          await sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(settingsTable)} (
              key TEXT PRIMARY KEY,
              value TEXT,
              updatedAt BIGINT
            )
          `.execute(trx);

          const lastMaint = await trx
            .selectFrom(settingsTable as any)
            .select('value')
            .where('key', '=', 'last_maintenance')
            .executeTakeFirst() as any;

          if (lastMaint && now - Number(lastMaint.value) < 10000) return;

          await trx
            .insertInto(settingsTable as any)
            .values({ key: 'last_maintenance', value: String(now), updatedAt: now } as any)
            .onConflict((oc: any) => oc.column('key').doUpdateSet({ value: String(now), updatedAt: now }))
            .execute();

          await this.reclaimStaleJobs();

          const pruneThreshold = now - this.pruneDoneAgeMs;
          const oldJobs = await trx
            .selectFrom(this.tableName as any)
            .select('id')
            .where('status', '=', 'done')
            .where('updatedAt', '<', pruneThreshold)
            .execute();

          if (oldJobs.length > 0) {
            const oldIds = oldJobs.map((j: any) => j.id);
            await trx
              .deleteFrom(this.tableName as any)
              .where('id', 'in', oldIds)
              .execute();
            console.info(`[SqliteQueue] Pruned ${oldIds.length} old completed jobs from ${this.tableName}.`);
          }
        });
      }
    } catch (e) {
      console.error('[SqliteQueue] Maintenance failed:', e);
    }
  }

  /**
   * Main processing loop with fluid concurrency and high-throughput batching.
   */
  async process(
    handler: JobHandler<T>,
    options: {
      concurrency?: number;
      pollIntervalMs?: number;
      batchSize?: number;
      completionFlushMs?: number;
    } = {}
  ) {
    const {
      concurrency = 500,
      pollIntervalMs = 1,
      batchSize = 500,
      completionFlushMs = 1,
    } = options;

    if (this.isProcessing) return;
    this.isProcessing = true;
    this.stopRequested = false;

    const maintenanceInterval = setInterval(() => this.performMaintenance(), 30000);

    let pendingCompletions: string[] = [];
    let pendingFailures: { id: string; error: string }[] = [];
    let completionFlushPending = false;
    let lastFlushTime = Date.now();

    const flushCompletions = async () => {
      completionFlushPending = false;
      lastFlushTime = Date.now();

      const completionsToFlush = pendingCompletions;
      const failuresToFlush = pendingFailures;
      pendingCompletions = [];
      pendingFailures = [];

      const promises: Promise<void>[] = [];

      if (completionsToFlush.length > 0) {
        promises.push(this.completeBatch(completionsToFlush));
      }

      if (failuresToFlush.length > 0) {
        if (this.memoryFirst) {
          const now = Date.now();
          const ops = failuresToFlush.map(({ id, error }) => ({
            type: 'update' as const,
            table: 'queue_jobs' as const,
            values: { status: 'failed' as const, error, updatedAt: now },
            where: { column: 'id', value: id },
            layer: 'infrastructure' as const,
          }));
          promises.push(dbPool.pushBatch(ops));
        } else {
          for (const { id, error } of failuresToFlush) {
            promises.push(this.fail(id, error));
          }
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }
    };

    const scheduleCompletion = (id: string) => {
      pendingCompletions.push(id);
      const shouldFlush =
        pendingCompletions.length >= batchSize ||
        (Date.now() - lastFlushTime > completionFlushMs && !completionFlushPending);

      if (shouldFlush && !completionFlushPending) {
        completionFlushPending = true;
        if (pendingCompletions.length >= batchSize) {
          setImmediate(() => {
            flushCompletions().catch((err) => console.error(err));
          });
        } else {
          setTimeout(() => {
            flushCompletions().catch((err) => console.error(err));
          }, 0);
        }
      }
    };

    const scheduleFailure = (id: string, error: string) => {
      pendingFailures.push({ id, error });
      if (pendingFailures.length >= batchSize && !completionFlushPending) {
        completionFlushPending = true;
        setImmediate(() => {
          flushCompletions().catch((err) => console.error(err));
        });
      }
    };

    let inFlightJobs = 0;
    const jobPromises = new Set<Promise<void>>();

    const runWorker = async () => {
      while (!this.stopRequested) {
        const limit = Math.min(batchSize, concurrency - inFlightJobs);

        if (limit <= 0) {
          if (jobPromises.size > 0) {
            await Promise.race(jobPromises);
          }
          continue;
        }

        const jobs = await this.dequeueBatch(limit);

        if (jobs.length === 0) {
          if (pendingCompletions.length > 0 || pendingFailures.length > 0) {
            await flushCompletions();
          }

          if (jobPromises.size > 0) {
            await Promise.race(jobPromises);
          } else {
            await new Promise((resolve) => {
              const onEnqueue = () => {
                clearTimeout(timeout);
                resolve(null);
              };
              const timeout = setTimeout(() => {
                this.wakeUpEmitter.removeListener('enqueue', onEnqueue);
                resolve(null);
              }, pollIntervalMs);
              this.wakeUpEmitter.once('enqueue', onEnqueue);
            });
          }
          continue;
        }

        const batchPromise = (async () => {
          const localJobs = jobs;

          await Promise.all(
            localJobs.map(async (jobInstance) => {
              const controller = new AbortController();
              this.activeControllers.add(controller);

              (jobInstance as any).signal = controller.signal;

              let heartbeatInterval: NodeJS.Timeout | undefined;
              if (!this.memoryFirst) {
                heartbeatInterval = setInterval(async () => {
                  try {
                    await this.heartbeat(jobInstance.id);
                  } catch (err) {
                    console.error(`[SqliteQueue] Background heartbeat failed for job ${jobInstance.id}:`, err);
                  }
                }, this.visibilityTimeoutMs / 3);
              }

              try {
                await handler(jobInstance);
                scheduleCompletion(jobInstance.id);
              } catch (err: unknown) {
                const error = err instanceof Error ? err.message : String(err);
                scheduleFailure(jobInstance.id, error);
              } finally {
                if (heartbeatInterval) {
                  clearInterval(heartbeatInterval);
                }
                this.activeControllers.delete(controller);
              }
            })
          );
        })();

        inFlightJobs += jobs.length;
        jobPromises.add(batchPromise);

        batchPromise
          .then(() => {
            inFlightJobs -= jobs.length;
            jobPromises.delete(batchPromise);
          })
          .catch(() => {
            inFlightJobs -= jobs.length;
            jobPromises.delete(batchPromise);
          });
      }
    };

    const worker = runWorker();

    const cleanup = async () => {
      clearInterval(maintenanceInterval);
      await Promise.all(jobPromises);
      await flushCompletions();
      this.isProcessing = false;
    };

    return worker.then(cleanup).catch(cleanup);
  }

  /**
   * High-throughput batch processing loop.
   */
  async processBatch(
    batchHandler: BatchJobHandler<T>,
    options: {
      pollIntervalMs?: number;
      batchSize?: number;
      maxInFlightBatches?: number;
      completionFlushMs?: number;
    } = {}
  ) {
    const {
      pollIntervalMs = 1,
      batchSize = 1000,
      maxInFlightBatches = 5,
      completionFlushMs = 1,
    } = options;

    if (this.isProcessing) return;
    this.isProcessing = true;
    this.stopRequested = false;

    const maintenanceInterval = setInterval(() => this.performMaintenance(), 30000);

    let pendingCompletions: string[] = [];
    let pendingFailures: { id: string; error: string }[] = [];
    let completionFlushPending = false;
    let lastFlushTime = Date.now();

    const flushCompletions = async () => {
      completionFlushPending = false;
      lastFlushTime = Date.now();

      const completionsToFlush = pendingCompletions;
      const failuresToFlush = pendingFailures;
      pendingCompletions = [];
      pendingFailures = [];

      const promises: Promise<void>[] = [];

      if (completionsToFlush.length > 0) {
        promises.push(this.completeBatch(completionsToFlush));
      }

      if (failuresToFlush.length > 0) {
        if (this.memoryFirst) {
          const now = Date.now();
          const ops = failuresToFlush.map(({ id, error }) => ({
            type: 'update' as const,
            table: 'queue_jobs' as const,
            values: { status: 'failed' as const, error, updatedAt: now },
            where: { column: 'id', value: id },
            layer: 'infrastructure' as const,
          }));
          promises.push(dbPool.pushBatch(ops));
        } else {
          for (const { id, error } of failuresToFlush) {
            promises.push(this.fail(id, error));
          }
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }
    };

    const scheduleCompletion = (id: string) => {
      pendingCompletions.push(id);
      const shouldFlush =
        pendingCompletions.length >= batchSize ||
        (Date.now() - lastFlushTime > completionFlushMs && !completionFlushPending);

      if (shouldFlush && !completionFlushPending) {
        completionFlushPending = true;
        if (pendingCompletions.length >= batchSize) {
          setImmediate(() => {
            flushCompletions().catch((err) => console.error(err));
          });
        } else {
          setTimeout(() => {
            flushCompletions().catch((err) => console.error(err));
          }, 0);
        }
      }
    };

    const scheduleFailure = (id: string, error: string) => {
      pendingFailures.push({ id, error });
      if (pendingFailures.length >= batchSize && !completionFlushPending) {
        completionFlushPending = true;
        setImmediate(() => {
          flushCompletions().catch((err) => console.error(err));
        });
      }
    };

    let inFlightBatches = 0;
    const batchPromises = new Set<Promise<void>>();

    const runWorker = async () => {
      while (!this.stopRequested) {
        if (inFlightBatches >= maxInFlightBatches) {
          await Promise.race(batchPromises);
          continue;
        }

        const jobs = await this.dequeueBatch(batchSize);

        if (jobs.length === 0) {
          if (pendingCompletions.length > 0 || pendingFailures.length > 0) {
            await flushCompletions();
          }

          if (batchPromises.size > 0) {
            await Promise.race(batchPromises);
          } else {
            await new Promise((resolve) => {
              const onEnqueue = () => {
                clearTimeout(timeout);
                resolve(null);
              };
              const timeout = setTimeout(() => {
                this.wakeUpEmitter.removeListener('enqueue', onEnqueue);
                resolve(null);
              }, pollIntervalMs);
              this.wakeUpEmitter.once('enqueue', onEnqueue);
            });
          }
          continue;
        }

        const currentBatchPromise = (async () => {
          const localJobs = jobs;
          const completedIds: string[] = [];
          const failedJobs: { id: string; error: string }[] = [];

          const controllers: AbortController[] = [];
          const heartbeatIntervals: NodeJS.Timeout[] = [];

          for (const jobInstance of localJobs) {
            const controller = new AbortController();
            this.activeControllers.add(controller);
            controllers.push(controller);
            (jobInstance as any).signal = controller.signal;

            if (!this.memoryFirst) {
              const heartbeatInterval = setInterval(async () => {
                try {
                  await this.heartbeat(jobInstance.id);
                } catch (err) {
                  console.error(`[SqliteQueue] Background heartbeat failed for job ${jobInstance.id}:`, err);
                }
              }, this.visibilityTimeoutMs / 3);
              heartbeatIntervals.push(heartbeatInterval);
            }
          }

          try {
            await batchHandler(localJobs);
            for (const job of localJobs) {
              completedIds.push(job.id);
            }
          } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            for (const job of localJobs) {
              failedJobs.push({ id: job.id, error });
            }
          } finally {
            for (const interval of heartbeatIntervals) {
              clearInterval(interval);
            }
            for (const controller of controllers) {
              this.activeControllers.delete(controller);
            }
          }

          for (const id of completedIds) {
            scheduleCompletion(id);
          }
          for (const fail of failedJobs) {
            scheduleFailure(fail.id, fail.error);
          }
        })();

        inFlightBatches++;
        batchPromises.add(currentBatchPromise);

        currentBatchPromise
          .then(() => {
            inFlightBatches--;
            batchPromises.delete(currentBatchPromise);
          })
          .catch(() => {
            inFlightBatches--;
            batchPromises.delete(currentBatchPromise);
          });
      }
    };

    const worker = runWorker();

    const cleanup = async () => {
      clearInterval(maintenanceInterval);
      await Promise.all(batchPromises);
      await flushCompletions();
      this.isProcessing = false;
    };

    return worker.then(cleanup).catch(cleanup);
  }

  stop() {
    this.stopRequested = true;
    this.isProcessing = false;
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  async close() {
    this.stop();
    if (this.privateConnection && this.db) {
      await this.db.destroy();
      this.db = null;
    }
  }

  async size(): Promise<number> {
    await this.ensureInitialized();
    if (this.memoryFirst) {
      const pendingJobs = await dbPool.selectWhere('queue_jobs', {
        column: 'status',
        value: 'pending',
      });
      return pendingJobs.length;
    } else {
      const result = await this.db!
        .selectFrom(this.tableName as any)
        .select((eb) => eb.fn.countAll().as('count'))
        .where('status', '=', 'pending')
        .executeTakeFirst() as any;
      return Number(result?.count || 0);
    }
  }

  async getMetrics() {
    await this.ensureInitialized();
    if (this.memoryFirst) {
      const allJobs = await dbPool.selectWhere('queue_jobs', []);
      return {
        pending: allJobs.filter((j) => j.status === 'pending').length,
        processing: allJobs.filter((j) => j.status === 'processing').length,
        done: allJobs.filter((j) => j.status === 'done').length,
        failed: allJobs.filter((j) => j.status === 'failed').length,
      };
    } else {
      const rows = await this.db!
        .selectFrom(this.tableName as any)
        .select(['status', (eb) => eb.fn.countAll().as('count')])
        .groupBy('status')
        .execute() as any[];

      const metrics = { pending: 0, processing: 0, done: 0, failed: 0 };
      for (const row of rows) {
        if (row.status in metrics) {
          (metrics as any)[row.status] = Number(row.count || 0);
        }
      }
      return metrics;
    }
  }
}
