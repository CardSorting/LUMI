import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-recovery-'));
  const dbPath = path.join(root, 'recovery.db');
  setDbPath(dbPath);

  const firstPool = new BufferedDbPool();
  await firstPool.start();
  try {
    for (let i = 0; i < 250; i++) {
      await firstPool.push({
        type: 'insert',
        table: 'queue_jobs',
        values: {
          id: `job-${i}`,
          payload: 'payload',
          status: 'pending',
          priority: 0,
          attempts: 0,
          maxAttempts: 5,
          runAt: Date.now(),
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    }
    await firstPool.flush();
    const health = await firstPool.health();
    assert.ok(health.lastSuccessfulFlush, 'flush health should record durability timestamp');
  } finally {
    await firstPool.stop();
  }

  const secondPool = new BufferedDbPool();
  await secondPool.start();
  try {
    const rows = await secondPool.selectWhere('queue_jobs', { column: 'status', value: 'pending' });
    assert.strictEqual(rows.length, 250);

    const warmed = await secondPool.warmupTable('queue_jobs', 'status', 'pending');
    assert.strictEqual(warmed, 250);

    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      assert.ok(fs.statSync(walPath).size <= 10 * 1024 * 1024);
    }
  } finally {
    await secondPool.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('crash_recovery.test failed:', error);
    process.exit(1);
  });
