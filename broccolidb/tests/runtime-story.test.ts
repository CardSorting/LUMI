import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-story-'));
  setDbPath(path.join(root, 'story.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'story-user', 'story-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'story-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'story-task' });
    const audit = await ctx.graph.spider.audit({ scope: 'all' });
    ctx.runtime.recordAudit(session.sessionId, audit);

    const story = ctx.runtime.story(session.sessionId);
    assert.ok(story.narrative.length > 0);
    assert.ok(Array.isArray(story.whatHappened));
    assert.ok(story.generatedAt > 0);
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-story.test failed:', e);
    process.exit(1);
  });
