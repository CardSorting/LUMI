import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-tx-'));
  const dbPath = path.join(root, 'tx.db');
  setDbPath(dbPath);

  const pool = new BufferedDbPool();
  await pool.start();
  try {
    await pool.runTransaction(async (agentId) => {
      await pool.push(
        {
          type: 'insert',
          table: 'users',
          values: { id: 'committed-user', createdAt: Date.now() },
        },
        agentId
      );
    });
    await pool.flush();
    assert.ok(await pool.selectOne('users', { column: 'id', value: 'committed-user' }));

    await assert.rejects(
      () =>
        pool.runTransaction(async (agentId) => {
          await pool.push(
            {
              type: 'insert',
              table: 'users',
              values: { id: 'rolled-back-user', createdAt: Date.now() },
            },
            agentId
          );
          throw new Error('rollback boundary');
        }),
      /rollback boundary/
    );
    await pool.flush();
    assert.strictEqual(
      await pool.selectOne('users', { column: 'id', value: 'rolled-back-user' }),
      null
    );

    pool.clearDeadLetterQueue();
    await pool.pushBatch([
      {
        type: 'insert',
        table: 'users',
        values: { id: 'rollback-batch-user', createdAt: Date.now() },
      },
      {
        type: 'insert',
        table: 'workspaces',
        values: {
          id: 'invalid-workspace',
          userId: 'missing-user',
          sharedMemoryLayer: '[]',
          createdAt: Date.now(),
        },
      },
    ]);
    await pool.flush();

    assert.strictEqual(
      await pool.selectOne('users', { column: 'id', value: 'rollback-batch-user' }),
      null,
      'failed flush should roll back the whole SQLite transaction'
    );
    assert.ok(pool.getDeadLetterQueue().length >= 2, 'failed flush should preserve DLQ evidence');
  } finally {
    await pool.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('transaction_boundaries.test failed:', error);
    process.exit(1);
  });
