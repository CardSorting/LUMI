import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-export-'));
  setDbPath(path.join(root, 'export.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'exp-user', 'exp-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'exp-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'export-test' });
    ctx.runtime.recordAudit(session.sessionId, await ctx.graph.spider.audit({ scope: 'all' }));

    const json = ctx.runtime.export(session.sessionId, { format: 'json' });
    const parsed = JSON.parse(json.content);
    assert.ok(parsed.state);
    assert.ok(parsed.timeline);

    const md = ctx.runtime.export(session.sessionId, { format: 'markdown' });
    assert.ok(md.content.includes('# Runtime Session'));

    const sarif = ctx.runtime.export(session.sessionId, { format: 'sarif' });
    const sarifParsed = JSON.parse(sarif.content);
    assert.strictEqual(sarifParsed.version, '2.1.0');
    assert.ok(sarifParsed.runs);
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-export.test failed:', error);
    process.exit(1);
  });
