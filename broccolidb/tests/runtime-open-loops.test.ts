import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-loops-'));
  setDbPath(path.join(root, 'loops.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'loop-user', 'loop-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'loop-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'loop-test' });
    const audit = await ctx.graph.spider.audit({ scope: 'all' });
    ctx.runtime.recordAudit(session.sessionId, audit);
    ctx.runtime.recordGate(session.sessionId, 1, audit.reportId);

    const loops = ctx.runtime.openLoops();
    assert.ok(loops.some((l) => l.sessionId === session.sessionId));
    assert.ok(loops.some((l) => l.loopKind === 'blocked' || l.loopKind === 'running'));

    const plan = ctx.runtime.planRepairs({ audit, sessionId: session.sessionId });
    ctx.runtime.requestApproval(plan);
    const approvalLoops = ctx.runtime.openLoops();
    assert.ok(approvalLoops.some((l) => l.loopKind === 'awaiting_approval'));
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-open-loops.test failed:', error);
    process.exit(1);
  });
