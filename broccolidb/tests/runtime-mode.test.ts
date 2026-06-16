import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { RuntimePolicyViolationError } from '../core/orchestration/runtime/RuntimePolicyEngine.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-mode-'));
  setDbPath(path.join(root, 'mode.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'mode-user', 'mode-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'mode-user');
  await ctx.start();

  try {
    ctx.runtime.setMode('readonly');
    assert.strictEqual(ctx.runtime.getMode(), 'readonly');

    const session = await ctx.runtime.beginSession({ taskId: 'mode-test' });
    const audit = await ctx.graph.spider.audit({ scope: 'all' });
    ctx.runtime.recordAudit(session.sessionId, audit);

    const plan = ctx.runtime.planRepairs({
      audit,
      policy: 'autonomous_safe',
      sessionId: session.sessionId,
    });

    if (plan.steps.length > 0) {
      await assert.rejects(
        () => ctx.runtime.execute({ plan, sessionId: session.sessionId }),
        RuntimePolicyViolationError
      );
    }

    const health = ctx.runtime.getRuntimeHealth();
    assert.strictEqual(health.runtimeMode, 'readonly');

    ctx.runtime.setMode('ci');
    assert.strictEqual(ctx.runtime.getMode(), 'ci');
    const ciHealth = ctx.runtime.getRuntimeHealth();
    assert.strictEqual(ciHealth.runtimeMode, 'ci');
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-mode.test failed:', error);
    process.exit(1);
  });
