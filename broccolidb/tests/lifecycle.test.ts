import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { LifecycleStateError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-lifecycle-'));
  const dbPath = path.join(root, 'lifecycle.db');
  setDbPath(dbPath);

  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'lifecycle-user', 'lifecycle-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'lifecycle-user');

  await assert.rejects(() => pool.selectOne('users', []), LifecycleStateError);
  await assert.rejects(() => context.storage.store('before-start'), LifecycleStateError);

  await context.start();
  try {
    const hash = await context.storage.store('durable order');
    assert.strictEqual(await context.storage.hydrate(hash), 'durable order');

    const health = await context.health();
    assert.strictEqual(health.lifecycle, 'started');
    assert.strictEqual(health.status, 'healthy');
    assert.ok(health.capabilities.storage);
  } finally {
    await context.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  await assert.rejects(() => pool.selectOne('users', []), LifecycleStateError);
  await assert.rejects(() => context.storage.store('after-stop'), LifecycleStateError);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('lifecycle.test failed:', error);
    process.exit(1);
  });
