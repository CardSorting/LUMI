import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-timeline-'));
  setDbPath(path.join(root, 'timeline.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'tl-user', 'tl-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'tl-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'timeline-test' });
    const audit = await ctx.graph.spider.audit({ scope: 'all' });
    ctx.runtime.recordAudit(session.sessionId, audit);
    ctx.runtime.recordGate(session.sessionId, 1, audit.reportId);

    const timeline = ctx.runtime.timeline(session.sessionId);
    assert.ok(timeline.length >= 3);
    const kinds = timeline.map((t) => t.kind);
    assert.ok(kinds.includes('Session'));
    assert.ok(kinds.includes('Audit'));
    assert.ok(kinds.includes('Gate'));

    for (let i = 1; i < timeline.length; i++) {
      assert.ok(timeline[i].timestamp >= timeline[i - 1].timestamp, 'timeline must be ordered');
    }
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-timeline.test failed:', error);
    process.exit(1);
  });
