import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-blockers-'));
  setDbPath(path.join(root, 'blockers.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'blk-user', 'blk-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'blk-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'blocker-test' });
    const audit = await ctx.graph.spider.audit({ scope: 'all', includeRepairDirectives: true });
    ctx.runtime.recordAudit(session.sessionId, audit);
    ctx.runtime.recordGate(session.sessionId, 1, audit.reportId);

    const blockers = ctx.runtime.blockers(session.sessionId);
    assert.ok(blockers.length >= 1);
    for (const b of blockers) {
      assert.ok(b.nextAction);
      assert.ok(b.nextAction.label);
      assert.ok(b.cause);
    }

    const state = ctx.runtime.state(session.sessionId);
    assert.ok(state.summary.openBlockerCount >= 1);
    assert.strictEqual(state.success, false);
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-blockers.test failed:', error);
    process.exit(1);
  });
