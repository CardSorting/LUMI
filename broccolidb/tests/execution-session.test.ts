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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-session-'));
  setDbPath(path.join(root, 'session.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'session-user', 'session-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'session-user');

  assert.throws(() => ctx.runtime.beginSession(), LifecycleStateError);

  await ctx.start();
  try {
    const session = ctx.runtime.beginSession({ taskId: 'repair-auth', agentId: 'agent-1' });
    assert.ok(session.sessionId);
    assert.strictEqual(session.status, 'running');
    assert.strictEqual(session.taskId, 'repair-auth');
    assert.strictEqual(session.agentId, 'agent-1');
    assert.deepStrictEqual(session.intents, []);
    assert.deepStrictEqual(session.audits, []);

    const retrieved = ctx.runtime.getSession(session.sessionId);
    assert.strictEqual(retrieved?.sessionId, session.sessionId);

    const traces = ctx.runtime.getTrace(session.sessionId);
    assert.ok(traces.some((t) => t.kind === 'session_started'));

    const health = ctx.runtime.getRuntimeHealth();
    assert.ok(health.activeSessions >= 1);
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('execution-session.test failed:', error);
    process.exit(1);
  });
