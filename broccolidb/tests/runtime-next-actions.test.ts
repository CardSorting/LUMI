import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-next-'));
  setDbPath(path.join(root, 'next.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'next-user', 'next-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'next-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'next-test' });
    const audit = await ctx.graph.spider.audit({ scope: 'all' });
    ctx.runtime.recordAudit(session.sessionId, audit);
    ctx.runtime.recordGate(session.sessionId, 1, audit.reportId);

    const next = ctx.runtime.nextActions(session.sessionId);
    assert.ok(next.length >= 1);
    assert.ok(next.some((a) => a.label.length > 0));
    assert.ok(
      next.some((a) => a.command?.includes('spider') || a.api?.includes('runtime') || a.api?.includes('spider')),
      'next actions must include concrete commands or APIs'
    );
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-next-actions.test failed:', error);
    process.exit(1);
  });
