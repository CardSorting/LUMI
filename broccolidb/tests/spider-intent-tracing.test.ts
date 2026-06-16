import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { SPIDER_WIRE_SCHEMA_V2 } from '../core/policy/spider/AgentSerialization.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-intent-'));
  setDbPath(path.join(root, 'intent.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'spider-intent-user', 'spider-intent-ws');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'spider-intent-user');
  await context.start();

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const A = 1;\n');

  const correlationId = 'spider-run-42';

  await context.graph.spider.check({
    phase: 'pre-edit',
    filePath: 'src/a.ts',
    includeTypes: false,
    correlationId,
  });

  await context.graph.spider.check({
    phase: 'ci',
    scope: ['src/a.ts'],
    includeTypes: false,
    correlationId,
    gatePreset: 'advisory',
  });

  const { traces } = await context.audit.traces({ limit: 20, correlationId });
  const spiderTraces = traces.filter(
    (t) => t.operation.startsWith('spider.') && t.status === 'succeeded'
  );
  assert.ok(spiderTraces.length >= 2, 'expected succeeded spider intent traces');
  for (const trace of spiderTraces) {
    assert.strictEqual(trace.correlationId, correlationId);
    assert.ok(trace.resultSummary?.spiderOperation || trace.operation.startsWith('spider.'));
  }

  const graphTraces = spiderTraces.filter((t) => t.capability === 'graph');
  assert.ok(graphTraces.length >= 2);
  const checkTrace = graphTraces.find((t) => t.operation === 'spider.check');
  assert.ok(checkTrace?.resultSummary && 'phase' in checkTrace.resultSummary);
  const advisoryTrace = graphTraces.find(
    (t) => (t.inputSummary as { gatePreset?: string })?.gatePreset === 'advisory'
  );
  assert.ok(advisoryTrace, 'expected gatePreset in intent input summary');

  await context.graph.spider.runAgentScenario('before-edit', {
    filePath: 'src/a.ts',
    correlationId,
  });

  const scenarioTrace = (await context.audit.traces({ limit: 30, correlationId })).traces.find(
    (t) => t.operation === 'spider.runAgentScenario' && t.status === 'succeeded'
  );
  assert.ok(scenarioTrace, 'expected runAgentScenario intent trace');
  assert.strictEqual((scenarioTrace?.inputSummary as { scenario?: string })?.scenario, 'before-edit');

  await context.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-intent-tracing.test failed:', error);
    process.exit(1);
  });
