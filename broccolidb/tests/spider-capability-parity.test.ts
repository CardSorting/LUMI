import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import {
  SPIDER_AGENT_ERGONOMICS_METHODS,
  SPIDER_GRAPH_ONLY_METHODS,
} from '../core/policy/spider/spider-agent-methods.js';
import { SPIDER_WIRE_SCHEMA_V2 } from '../core/policy/spider/AgentSerialization.js';
import { restoreFromWire, parseNdjsonStream } from '../core/policy/spider/AgentWireRestore.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-parity-'));
  setDbPath(path.join(root, 'parity.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'parity-user', 'parity-ws');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'parity-user');
  await context.start();

  for (const method of SPIDER_AGENT_ERGONOMICS_METHODS) {
    assert.strictEqual(
      typeof (context.graph.spider as Record<string, unknown>)[method],
      'function',
      `graph.spider.${method} missing`
    );
    assert.strictEqual(
      typeof (context.audit.spider as Record<string, unknown>)[method],
      'function',
      `audit.spider.${method} missing`
    );
  }

  for (const method of SPIDER_GRAPH_ONLY_METHODS) {
    assert.strictEqual(
      typeof (context.graph.spider as Record<string, unknown>)[method],
      'function',
      `graph.spider.${method} missing`
    );
    assert.strictEqual(
      (context.audit.spider as Record<string, unknown>)[method],
      undefined,
      `audit.spider must not expose graph-only ${method}`
    );
  }

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const A = 1;\n');

  const check = await context.graph.spider.check({
    phase: 'pre-edit',
    filePath: 'src/a.ts',
    includeTypes: false,
  });
  assert.strictEqual(check.wire?.wireSchema, SPIDER_WIRE_SCHEMA_V2);
  assert.ok(check.wire?.ndjsonStream?.includes('spider.check.start'));

  const restored = context.graph.spider.restoreFromWire(check.wire!);
  assert.strictEqual(restored.wire.reportId, check.wire!.reportId);
  assert.ok(restored.digest.includes('Spider Wire'));
  assert.ok(restored.ndjsonEvents && restored.ndjsonEvents.length >= 2);

  const events = context.graph.spider.parseNdjsonStream(check.wire!.ndjsonStream!);
  assert.ok(events.some((e) => e.type === 'spider.check.end'));

  const auditRestored = context.audit.spider.restoreFromWire(check.wire!);
  assert.strictEqual(auditRestored.exitCode, check.exitCode);

  const auditCheck = await context.audit.spider.checkAndRespond({
    phase: 'ci',
    scope: ['src/a.ts'],
    includeTypes: false,
  });
  assert.strictEqual(auditCheck.$schema, 'broccolidb.spider.check-response/v1');

  const handoff = context.graph.spider.handoffFromCheck(check);
  assert.strictEqual(handoff.wire?.wireSchema, SPIDER_WIRE_SCHEMA_V2);
  assert.strictEqual(handoff.checkResponse?.$schema, 'broccolidb.spider.check-response/v1');
  assert.ok(context.audit.spider.formatCatalogPrompt().includes('Spider Forensic Agent Runbook'));

  await context.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-capability-parity.test failed:', error);
    process.exit(1);
  });
