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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-capability-'));
  setDbPath(path.join(root, 'spider-cap.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'cap-user', 'spider-cap');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'cap-user');

  await assert.rejects(
    () =>
      context.graph.spider.audit({
        scope: 'all',
        includeTypes: false,
        includeRepairDirectives: false,
      }),
    LifecycleStateError
  );

  await context.start();
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const filePath = 'src/module.ts';
  fs.writeFileSync(path.join(root, filePath), 'export const ok = true;\n');

  const audit = await context.graph.spider.audit({
    scope: [filePath],
    includeTypes: false,
    includeRepairDirectives: true,
  });
  assert.ok(audit.health.pure);
  assert.strictEqual(typeof audit.entropy, 'number');

  fs.writeFileSync(path.join(root, filePath), 'export const ok = false;\n');
  const resync = await context.graph.spider.resync({ files: [filePath] });
  assert.ok(resync.resynced.includes(filePath));
  assert.ok(Array.isArray(resync.parity));

  assert.strictEqual(typeof context.graph.spider.applyChanges, 'function');
  assert.strictEqual(typeof context.graph.spider.bootstrapGraph, 'function');
  assert.strictEqual((context.graph.spider as { getEngine?: unknown }).getEngine, undefined);

  await context.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-capability-api.test failed:', error);
    process.exit(1);
  });
