import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BufferedDbPool, dbPool } from '../db/BufferedDbPool.js';

export interface QueueJob<T> {
  id: string;
  payload: T;
  status: 'pending' | 'processing' | 'done' | 'failed';
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type JobHandler<T> = (job: QueueJob<T>) => Promise<void>;
export type BatchJobHandler<T> = (jobs: QueueJob<T>[]) => Promise<void>;

export interface SqliteQueueOptions {
  dbPath?: string;
  tableName?: string;
  visibilityTimeoutMs?: number;
  pruneDoneAgeMs?: number;
  defaultMaxAttempts?: number;
  baseRetryDelayMs?: number;
}

/**
 * SqliteQueue provides a hardened, production-grade background job processor.
 * It uses BufferedDbPool for high-throughput, buffered database operations.
 */
export class SqliteQueue<T> {
  private isProcessing = false;
  private stopRequested = false;
  private wakeUpEmitter = new EventEmitter();

  private pendingMemoryBuffer: (QueueJob<T> | null)[] = new Array(1000000).fill(null);
  private bufferHead = 0;
  private bufferTail = 0;
  private maxMemoryBufferSize = 1000000; // Event Horizon scale

  private visibilityTimeoutMs: number;
  private pruneDoneAgeMs: number;
  private defaultMaxAttempts: number;
  private baseRetryDelayMs: number;

  private bufferSize(): number {
    return (
      (this.bufferTail - this.bufferHead + this.maxMemoryBufferSize) % this.maxMemoryBufferSize
    );
  }

  constructor(options: SqliteQueueOptions = {}) {
    const {
      visibilityTimeoutMs = 300000, // 5 minutes default
      pruneDoneAgeMs = 86400000, // 24 hours default
      defaultMaxAttempts = 5,
      baseRetryDelayMs = 1000,
    } = options;

    this.visibilityTimeoutMs = visibilityTimeoutMs;
    this.pruneDoneAgeMs = pruneDoneAgeMs;
    this.defaultMaxAttempts = defaultMaxAttempts;
    this.baseRetryDelayMs = baseRetryDelayMs;
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
    };

    await dbPool.push({
      type: 'upsert',
      table: 'queue_jobs',
      values,
      where: { column: 'id', value: jobId },
      layer: 'infrastructure',
    });

    // Memory-First: Circular Buffer Push (O(1))
    if (runAt <= now && this.bufferSize() < this.maxMemoryBufferSize - 1) {
      this.pendingMemoryBuffer[this.bufferTail] = {
        ...values,
        payload: payload as T,
      } as unknown as QueueJob<T>;
      this.bufferTail = (this.bufferTail + 1) % this.maxMemoryBufferSize;
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
    const ids: string[] = [];
    const now = Date.now();
    const ops = items.map((item) => {
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
      };

      // Memory-First: Circular Buffer Push (O(1))
      if (runAt <= now && this.bufferSize() < this.maxMemoryBufferSize - 1) {
        this.pendingMemoryBuffer[this.bufferTail] = {
          ...values,
          payload: item.payload as T,
        } as unknown as QueueJob<T>;
        this.bufferTail = (this.bufferTail + 1) % this.maxMemoryBufferSize;
      }

      return {
        type: 'insert' as const,
        table: 'queue_jobs' as const,
        values,
        layer: 'infrastructure' as const,
      };
    });

    await dbPool.pushBatch(ops);
    this.wakeUpEmitter.emit('enqueue');
    return ids;
  }

  /**
   * Dequeue multiple jobs atomically using a transaction.
   * Prioritizes Memory-First buffer over DB polling.
   */
  async dequeueBatch(limit: number): Promise<QueueJob<T>[]> {
    const memoryJobsCount = this.bufferSize();
    // Memory-First: Try local circular buffer first (O(1) pop)
    if (memoryJobsCount > 0) {
      const actualLimit = Math.min(limit, memoryJobsCount);
      const jobs: QueueJob<T>[] = [];

      for (let i = 0; i < actualLimit; i++) {
        const job = this.pendingMemoryBuffer[this.bufferHead];
        if (job) jobs.push(job);
        this.pendingMemoryBuffer[this.bufferHead] = null; // GC friendly
        this.bufferHead = (this.bufferHead + 1) % this.maxMemoryBufferSize;
      }

      const ids = jobs.map((j) => j.id);
      const nowMs = Date.now();

      // Non-blocking update (doubling down on write-behind)
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

      return jobs.map((job) => ({
        ...job,
        status: 'processing',
        updatedAt: nowMs,
        attempts: job.attempts + 1,
      }));
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
            limit: limit * 2, // Fetch extra for pre-filling local buffer
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

        // Split into immediate return and local buffer
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

        // Fill memory buffer for next call
        if (toBuffer.length > 0) {
          this.pendingMemoryBuffer.push(...toBuffer);
        }

        return mappedJobs.slice(0, limit);
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

    const staleJobs = await dbPool.selectWhere('queue_jobs', [
      { column: 'status', value: 'processing' },
      { column: 'updatedAt', value: threshold, operator: '<' },
    ]);

    if (staleJobs.length === 0) return 0;

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

    console.warn(`[SqliteQueue] Reclaiming ${staleJobs.length} stale jobs.`);
    return staleJobs.length;
  }

  /**
   * Mark multiple jobs as completed in a single high-throughput update.
   */
  async completeBatch(ids: string[]) {
    if (ids.length === 0) return;
    const now = Date.now();
    await dbPool.push({
      type: 'update',
      table: 'queue_jobs',
      values: { status: 'done', updatedAt: now },
      where: { column: 'id', value: ids, operator: 'IN' },
      layer: 'infrastructure',
    });
  }

  /**
   * Completed task handling.
   */
  async complete(id: string) {
    const now = Date.now();
    await dbPool.push({
      type: 'update',
      table: 'queue_jobs',
      values: { status: 'done', updatedAt: now },
      where: { column: 'id', value: id },
      layer: 'infrastructure',
    });
  }

  /**
   * Failure handling with exponential backoff.
   */
  async fail(id: string, error: string) {
    const now = Date.now();
    const job = await dbPool.selectOne('queue_jobs', { column: 'id', value: id });

    if (!job) return;

    if (job.attempts < job.maxAttempts) {
      // Exponential backoff: 2^attempts * baseDelay
      const nextDelay = 2 ** (job.attempts - 1) * this.baseRetryDelayMs;
      const nextRun = now + nextDelay;

      await dbPool.push({
        type: 'update',
        table: 'queue_jobs',
        values: { status: 'pending', runAt: nextRun, error, updatedAt: now },
        where: { column: 'id', value: id },
        layer: 'infrastructure',
      });

      console.warn(`[SqliteQueue] Job ${id} failed. Retrying in ${nextDelay}ms...`);
    } else {
      // Permanently failed (DLQ-equivalent)
      await dbPool.push({
        type: 'update',
        table: 'queue_jobs',
        values: { status: 'failed', error, updatedAt: now },
        where: { column: 'id', value: id },
        layer: 'infrastructure',
      });

      console.error(`[SqliteQueue] Job ${id} failed permanently after ${job.attempts} attempts.`);
    }
  }

  /**
   * Health check and automated maintenance.
   */
  async performMaintenance(): Promise<void> {
    const now = Date.now();

    try {
      await dbPool.runTransaction(async (agentId) => {
        const lastMaint = await dbPool.selectOne(
          'queue_settings',
          { column: 'key', value: 'last_maintenance' },
          agentId
        );
        if (lastMaint && now - Number(lastMaint.value) < 10000) return; // Only once every 10s

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

        // 1. Reclaim stale jobs
        await this.reclaimStaleJobs();

        // 2. Prune old 'done' jobs
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
          console.log(`[SqliteQueue] Pruned ${oldJobs.length} old completed jobs.`);
        }
      });
    } catch (e) {
      console.error('[SqliteQueue] Maintenance failed:', e);
    }
  }

  /**
   * Main processing loop with fluid concurrency and high-throughput batching.
   * Optimized for individual job handlers with pipelined completion batching.
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

    // Background maintenance loop (every 30s)
    const maintenanceInterval = setInterval(() => this.performMaintenance(), 30000);

    // Completion batching state
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
        // Batch fail operations
        const now = Date.now();
        const ops = failuresToFlush.map(({ id, error }) => ({
          type: 'update' as const,
          table: 'queue_jobs' as const,
          values: { status: 'failed' as const, error, updatedAt: now },
          where: { column: 'id', value: id },
          layer: 'infrastructure' as const,
        }));
        promises.push(dbPool.pushBatch(ops));
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
        // Use setImmediate for immediate flush, setTimeout for debounced
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

    // Pipeline state
    let inFlightJobs = 0;
    const jobPromises = new Set<Promise<void>>();

    const runWorker = async () => {
      while (!this.stopRequested) {
        // Pipeline: dequeue next batch while previous is processing
        const limit = Math.min(batchSize, concurrency - inFlightJobs);

        if (limit <= 0) {
          // Wait for some jobs to complete before dequeuing more
          if (jobPromises.size > 0) {
            await Promise.race(jobPromises);
          }
          continue;
        }

        const jobs = await this.dequeueBatch(limit);

        if (jobs.length === 0) {
          // No jobs available - flush any pending completions and wait
          if (pendingCompletions.length > 0 || pendingFailures.length > 0) {
            await flushCompletions();
          }

          if (jobPromises.size > 0) {
            // Wait for in-flight jobs to complete
            await Promise.race(jobPromises);
          } else {
            // Nothing in flight, wait for new jobs
            await Promise.race([
              new Promise((resolve) => setTimeout(resolve, pollIntervalMs)),
              new Promise((resolve) => this.wakeUpEmitter.once('enqueue', resolve)),
            ]);
          }
          continue;
        }

        // Process jobs concurrently as a batch
        const batchPromise = (async () => {
          const localJobs = jobs;

          await Promise.all(
            localJobs.map(async (job) => {
              try {
                await handler(job);
                scheduleCompletion(job.id);
              } catch (err: unknown) {
                const error = err instanceof Error ? err.message : String(err);
                scheduleFailure(job.id, error);
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

        // Non-blocking continuation - immediately try to dequeue more
        // No setImmediate needed - the await at top of loop handles backpressure
      }
    };

    const worker = runWorker();

    const cleanup = async () => {
      clearInterval(maintenanceInterval);
      // Wait for in-flight jobs and flush final completions
      await Promise.all(jobPromises);
      await flushCompletions();
      this.isProcessing = false;
    };

    worker.then(cleanup).catch(cleanup);
  }

  /**
   * High-throughput batch processing loop.
   * Processes jobs in true batches, reducing transaction overhead by 10x or more.
   *
   * @param batchHandler - Receives an array of jobs to process as a batch
   * @param options - Configuration options
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

    // Background maintenance loop (every 30s)
    const maintenanceInterval = setInterval(() => this.performMaintenance(), 30000);

    // Completion batching state
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
        const now = Date.now();
        const ops = failuresToFlush.map(({ id, error }) => ({
          type: 'update' as const,
          table: 'queue_jobs' as const,
          values: { status: 'failed' as const, error, updatedAt: now },
          where: { column: 'id', value: id },
          layer: 'infrastructure' as const,
        }));
        promises.push(dbPool.pushBatch(ops));
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

    // Pipeline state - track in-flight batch processing
    let inFlightBatches = 0;
    const batchPromises = new Set<Promise<void>>();

    const runWorker = async () => {
      while (!this.stopRequested) {
        // Pipeline backpressure: limit concurrent batches
        if (inFlightBatches >= maxInFlightBatches) {
          await Promise.race(batchPromises);
          continue;
        }

        const jobs = await this.dequeueBatch(batchSize);

        if (jobs.length === 0) {
          // No jobs - flush completions and wait
          if (pendingCompletions.length > 0 || pendingFailures.length > 0) {
            await flushCompletions();
          }

          if (batchPromises.size > 0) {
            await Promise.race(batchPromises);
          } else {
            await Promise.race([
              new Promise((resolve) => setTimeout(resolve, pollIntervalMs)),
              new Promise((resolve) => this.wakeUpEmitter.once('enqueue', resolve)),
            ]);
          }
          continue;
        }

        // Process batch
        const currentBatchPromise = (async () => {
          const localJobs = jobs;
          const completedIds: string[] = [];
          const failedJobs: { id: string; error: string }[] = [];

          try {
            // User's batch handler processes all jobs
            await batchHandler(localJobs);

            // Mark all as completed (user is responsible for individual failures)
            for (const job of localJobs) {
              completedIds.push(job.id);
            }
          } catch (err: unknown) {
            // Batch handler failed entirely - mark all as failed
            const error = err instanceof Error ? err.message : String(err);
            for (const job of localJobs) {
              failedJobs.push({ id: job.id, error });
            }
          }

          // Queue completions/failures for batch flush
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

        // Immediately try to dequeue next batch (pipelining)
      }
    };

    const worker = runWorker();

    const cleanup = async () => {
      clearInterval(maintenanceInterval);
      await Promise.all(batchPromises);
      await flushCompletions();
      this.isProcessing = false;
    };

    worker.then(cleanup).catch(cleanup);
  }

  stop() {
    this.stopRequested = true;
    this.isProcessing = false;
  }

  async size(): Promise<number> {
    const pendingJobs = await dbPool.selectWhere('queue_jobs', {
      column: 'status',
      value: 'pending',
    });
    return pendingJobs.length;
  }

  async getMetrics() {
    const allJobs = await dbPool.selectWhere('queue_jobs', []);
    return {
      pending: allJobs.filter((j) => j.status === 'pending').length,
      processing: allJobs.filter((j) => j.status === 'processing').length,
      done: allJobs.filter((j) => j.status === 'done').length,
      failed: allJobs.filter((j) => j.status === 'failed').length,
    };
  }

  async close() {
    this.stop();
  }
}
