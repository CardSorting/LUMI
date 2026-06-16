import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deterministic-replay-'));
  setDbPath(path.join(root, 'replay.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'replay-user', 'replay-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'replay-user');
  await ctx.start();

  try {
    ctx.runtime.setMode('forensic');
    const session = await ctx.runtime.beginSession({ taskId: 'forensic-replay' });
    const before = fs.readdirSync(root);

    const replay = await ctx.runtime.replay(session.sessionId, { mode: 'forensic' });
    assert.strictEqual((replay as { readonly?: boolean }).readonly, true);
    assert.strictEqual(replay.mode, 'forensic');
    assert.ok(replay.journal.some((e) => e.kind === 'session_started'));

    const after = fs.readdirSync(root);
    assert.deepStrictEqual(before, after, 'replay must not mutate disk');

    const traces = ctx.runtime.getTrace(session.sessionId);
    assert.ok(traces.length >= 1);
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('deterministic-replay.test failed:', error);
    process.exit(1);
  });
