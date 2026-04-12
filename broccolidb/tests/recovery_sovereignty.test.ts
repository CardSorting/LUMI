import assert from 'node:assert';
import fs from 'node:fs';
import { dbPool } from '../infrastructure/db/BufferedDbPool.js';

async function runTest() {
  const dbPath = './test-warmup.db';
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  console.info('--- PHASE 1: FILLING THE NOTEBOOK ---');
  // 1. Initial State
  for (let i = 0; i < 100; i++) {
    await dbPool.push({
      type: 'insert',
      table: 'queue_jobs' as never,
      values: {
        id: `job-${i}`,
        payload: 'test',
        status: 'pending',
        priority: 0,
        attempts: 0,
        maxAttempts: 5,
        runAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  }
  await dbPool.flush();

  // Verify disk has data
  const initialSelect = await dbPool.selectWhere('queue_jobs', {
    column: 'status',
    value: 'pending',
  });
  assert.strictEqual(initialSelect.length, 100, 'Initial setup failed');

  console.info('--- PHASE 2: REBOOTING (CLEARING BRAIN) ---');
  // 2. Simulate Reboot (Clean the in-memory indexes)
  // @ts-expect-error - Accessing private member for testing purposes
  (dbPool as any).activeIndex.clear();
  // @ts-expect-error - Accessing private member for testing purposes
  (dbPool as any).activeBuffer.clear();

  // 3. Verify Brain is empty (Cold Start)
  // @ts-expect-error - Accessing private member for testing purposes
  const coldIndex = (dbPool as any).activeIndex.get('queue_jobs')?.get('status:pending');
  assert.strictEqual(coldIndex?.size || 0, 0, 'Brain was not successfully cleared');

  console.info('--- PHASE 3: WARMING UP (SOVEREIGN RECOVERY) ---');
  // 4. Perform Warmup
  const startWarmup = performance.now();
  const warmedCount = await dbPool.warmupTable('queue_jobs', 'status', 'pending');
  const duration = performance.now() - startWarmup;

  console.info(`Warmup complete: ${warmedCount} items hydrated in ${duration.toFixed(2)}ms`);

  // 5. Verify Brain is Warmed
  // @ts-expect-error - Accessing private member for testing purposes
  const warmIndex = (dbPool as any).activeIndex.get('queue_jobs')?.get('status:pending');
  assert.strictEqual(warmIndex?.size, 100, 'Brain failed to hydrate from Notebook');

  // 6. Fast Query Test
  const startQuery = performance.now();
  const results = await dbPool.selectWhere('queue_jobs', { column: 'status', value: 'pending' });
  const queryDuration = performance.now() - startQuery;

  console.info(`Fast Query (from RAM): ${results.length} items in ${queryDuration.toFixed(4)}ms`);

  assert.strictEqual(results.length, 100, 'Final query failed');
  console.info('✅ TEST PASSED: Sovereign Recovery (Level 9) verified.');

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}

runTest().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
