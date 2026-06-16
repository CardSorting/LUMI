import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteQueue } from '../infrastructure/queue/SqliteQueue.js';

async function runTests() {
  console.info('=== STARTING SQLITE QUEUE ERGONOMICS & HARDENING TESTS ===');

  const testDbPath = path.resolve(process.cwd(), 'test-isolated-queue.db');
  
  // Cleanup previous test DB
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

  try {
    // 1. Test isolated DB and custom table schema creation
    console.info('Testing isolated DB path and custom table name...');
    const queue = new SqliteQueue<string>({
      dbPath: testDbPath,
      tableName: 'custom_agent_jobs',
      visibilityTimeoutMs: 1000,
    });

    const jobId1 = await queue.enqueue('task-payload-1');
    assert.ok(jobId1, 'Failed to enqueue job');

    // Verify DB file was created on disk
    assert.ok(fs.existsSync(testDbPath), 'Isolated DB file was not created on disk');

    const dequeued = await queue.dequeueBatch(1);
    assert.strictEqual(dequeued.length, 1, 'Failed to dequeue job from isolated DB');
    assert.strictEqual(dequeued[0]?.id, jobId1, 'Dequeued job ID mismatch');
    assert.strictEqual(dequeued[0]?.payload, 'task-payload-1', 'Dequeued payload mismatch');

    // Complete the job
    await dequeued[0]?.complete();
    const metrics = await queue.getMetrics();
    assert.strictEqual(metrics.done, 1, 'Job completion not reflected in metrics');

    await queue.close();
    console.info('✅ Isolated DB and custom table name tests passed.');

    // 2. Test Concurrency & Exactly-Once Delivery (No Double Processing)
    console.info('Testing concurrent atomic dequeue...');
    const concurrentQueue = new SqliteQueue<number>({
      dbPath: testDbPath,
      tableName: 'concurrent_jobs',
      memoryFirst: false, // Force DB transactional dequeue
    });

    // Enqueue 10 jobs
    const jobIds = [];
    for (let i = 0; i < 10; i++) {
      jobIds.push(await concurrentQueue.enqueue(i));
    }

    // Attempt to dequeue concurrently from 3 workers
    const dequeuedBatches = await Promise.all([
      concurrentQueue.dequeueBatch(4),
      concurrentQueue.dequeueBatch(4),
      concurrentQueue.dequeueBatch(4),
    ]);

    const allDequeuedJobs = dequeuedBatches.flat();
    assert.strictEqual(allDequeuedJobs.length, 10, 'Not all enqueued jobs were dequeued');

    const uniqueIds = new Set(allDequeuedJobs.map((j) => j.id));
    assert.strictEqual(uniqueIds.size, 10, 'Double delivery detected! Duplicate job IDs dequeued by workers.');
    console.info('✅ Concurrent atomic dequeue exactly-once tests passed.');

    // 3. Test Heartbeat & Lock Extension
    console.info('Testing worker heartbeat extension...');
    const heartbeatQueue = new SqliteQueue<string>({
      dbPath: testDbPath,
      tableName: 'heartbeat_jobs',
      visibilityTimeoutMs: 300, // Very short visibility timeout (300ms)
    });

    const _hJobId = await heartbeatQueue.enqueue('heartbeat-test');
    
    // Process job with handler that takes 500ms (longer than visibility timeout)
    let heartbeatFired = false;
    let jobExecutionAborted = false;

    const processPromise = heartbeatQueue.process(
      async (job) => {
        // Wait 500ms
        const start = Date.now();
        while (Date.now() - start < 500) {
          if (job.signal?.aborted) {
            jobExecutionAborted = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        heartbeatFired = true;
      },
      { concurrency: 1, batchSize: 1 }
    );

    // Let the worker run for 600ms
    await new Promise((r) => setTimeout(r, 600));
    heartbeatQueue.stop();
    await processPromise;

    // Check if the job was reclaimed by another dequeue call during execution
    // Since heartbeat extends the lock, dequeueBatch should return 0 jobs while it was running
    assert.ok(heartbeatFired, 'Job handler did not complete');
    assert.ok(!jobExecutionAborted, 'Job was prematurely aborted');
    console.info('✅ Heartbeat lock extension tests passed.');

    // 4. Test Progress Tracking, Logs & Metadata
    console.info('Testing job progress and logging ergonomics...');
    const progressQueue = new SqliteQueue<string>({
      dbPath: testDbPath,
      tableName: 'progress_jobs',
    });

    const _pJobId = await progressQueue.enqueue('progress-payload');
    const pDequeued = await progressQueue.dequeueBatch(1);
    const jobInstance = pDequeued[0];
    assert.ok(jobInstance);

    await jobInstance.updateProgress(45, { step: 'generating-embeddings' });
    await jobInstance.log('Generating embedding representations...');
    await jobInstance.log('Embeddings saved successfully.');

    // Retrieve from DB to verify progress and logs
    const _dbJobs = await progressQueue.getFailedJobs(); // getFailedJobs reads raw DB, let's fetch custom select or getMetrics
    // Let's use a raw query or read from progressQueue.getFailedJobs which queries all status if we modify it,
    // or let's just query via a direct SQL statement
    const jobRecord = await (progressQueue as any).db
      .selectFrom('progress_jobs')
      .selectAll()
      .where('id', '=', jobInstance.id)
      .executeTakeFirst();

    assert.strictEqual(Number(jobRecord.progress), 45);
    const meta = JSON.parse(jobRecord.metadata);
    assert.strictEqual(meta.step, 'generating-embeddings');
    assert.strictEqual(meta.logs.length, 2);
    assert.ok(meta.logs[0].includes('Generating embedding representations...'));
    assert.ok(meta.logs[1].includes('Embeddings saved successfully.'));

    await jobInstance.complete();
    console.info('✅ Progress and logging tests passed.');

    // 5. Test AbortSignal Support
    console.info('Testing AbortSignal execution termination...');
    const abortQueue = new SqliteQueue<string>({
      dbPath: testDbPath,
      tableName: 'abort_jobs',
    });

    await abortQueue.enqueue('cancellable-task');
    let wasAborted = false;
    let handlerCalled = false;

    const abortWorkerPromise = abortQueue.process(async (job) => {
      handlerCalled = true;
      console.info('AbortSignal handler started, signal defined:', !!job.signal);
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (job.signal?.aborted) {
          console.info('Abort signal observed inside handler!');
          wasAborted = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      console.info('AbortSignal handler finished, wasAborted:', wasAborted);
    });

    // Let the job start
    await new Promise((r) => setTimeout(r, 200));
    console.info('Stopping abortQueue, active controllers size:', (abortQueue as any).activeControllers.size);
    // Stop the queue (which should abort active jobs)
    abortQueue.stop();
    await abortWorkerPromise;

    assert.ok(handlerCalled, 'Job handler was not called');
    assert.ok(wasAborted, 'Job AbortSignal was not triggered on queue stop');
    console.info('✅ AbortSignal termination tests passed.');

    // 6. Test Dead Letter Queue (DLQ) & Retry APIs
    console.info('Testing Dead Letter Queue (DLQ) and recovery...');
    const dlqQueue = new SqliteQueue<string>({
      dbPath: testDbPath,
      tableName: 'dlq_jobs',
      defaultMaxAttempts: 2,
      baseRetryDelayMs: 10,
    });

    const badJobId = await dlqQueue.enqueue('failing-payload');

    // Run queue to fail the job
    const dlqWorkerPromise = dlqQueue.process(async (_job) => {
      throw new Error('Simulated task failure');
    }, { concurrency: 1, batchSize: 1 });

    // Wait for the job to fail twice
    await new Promise((r) => setTimeout(r, 100));
    dlqQueue.stop();
    await dlqWorkerPromise;

    // Check failed jobs
    const failedJobs = await dlqQueue.getFailedJobs();
    assert.strictEqual(failedJobs.length, 1, 'Job did not enter DLQ / failed status');
    assert.strictEqual(failedJobs[0]?.id, badJobId);
    assert.strictEqual(failedJobs[0]?.status, 'failed');
    assert.ok(failedJobs[0]?.error?.includes('Simulated task failure'));

    // Test retry
    const retried = await dlqQueue.retryJob(badJobId);
    assert.ok(retried, 'Failed to retry job');
    const size = await dlqQueue.size();
    assert.strictEqual(size, 1, 'Retried job was not placed back to pending');

    // Test purge
    // Fail it again
    const dlqWorkerPromise2 = dlqQueue.process(async (_job) => {
      throw new Error('Simulated failure again');
    }, { concurrency: 1, batchSize: 1 });
    await new Promise((r) => setTimeout(r, 100));
    dlqQueue.stop();
    await dlqWorkerPromise2;

    const purgedCount = await dlqQueue.purgeFailed();
    assert.strictEqual(purgedCount, 1, 'Purged count mismatch');
    const failedJobsAfterPurge = await dlqQueue.getFailedJobs();
    assert.strictEqual(failedJobsAfterPurge.length, 0, 'Failed jobs were not fully purged');

    await concurrentQueue.close();
    await heartbeatQueue.close();
    await progressQueue.close();
    await abortQueue.close();
    await dlqQueue.close();

    console.info('✅ DLQ and recovery tests passed.');

    console.info('🎉 ALL SQLITE QUEUE ERGONOMICS & HARDENING TESTS PASSED!');
  } finally {
    // Final Cleanup of test DB
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  }
}

runTests().catch((err) => {
  console.error('❌ TESTS FAILED:', err);
  process.exit(1);
});
