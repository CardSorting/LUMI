import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-smoke-'));
  setDbPath(path.join(root, 'recovery.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'recovery-user', 'recovery-ws');
  workspace.setPhysicalPath(root);

  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'app.ts'), 'export const app = 1;\n');
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] })
  );

  let sessionId = '';
  const ctx1 = new AgentContext(workspace, pool, 'recovery-user');
  await ctx1.start();
  try {
    const session = await ctx1.runtime.beginSession({ taskId: 'recovery-smoke' });
    sessionId = session.sessionId;
    const audit = await ctx1.graph.spider.audit({ scope: 'all' });
    ctx1.runtime.recordAudit(sessionId, audit);
    await ctx1.runtime.snapshot(sessionId);
    await ctx1.flush();
  } finally {
    await ctx1.stop();
  }

  const pool2 = new BufferedDbPool();
  await pool2.start();
  const workspace2 = new Workspace(pool2, 'recovery-user', 'recovery-ws');
  workspace2.setPhysicalPath(root);
  await workspace2.init();
  const ctx2 = new AgentContext(workspace2, pool2, 'recovery-user');
  await ctx2.start();
  try {
    const memory = ctx2.runtime.getMemoryHealth();
    assert.ok(memory.snapshotCount >= 1, 'snapshot should persist across restart');
    const replay = await ctx2.runtime.replay(sessionId, { mode: 'forensic' });
    assert.strictEqual(replay.sessionId, sessionId);
    const story = ctx2.runtime.story(sessionId);
    assert.ok(story.narrative.length > 0, 'story should work after restart');
    const state = ctx2.runtime.state(sessionId);
    assert.ok(state.sessionId === sessionId);
  } finally {
    await ctx2.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => {
    console.log('runtime-recovery-smoke: OK');
    process.exit(0);
  })
  .catch((e) => {
    console.error('runtime-recovery-smoke failed:', e);
    process.exit(1);
  });
