import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { AgentGitError, LifecycleStateError } from '../core/errors.js';
import { IntentTracer } from '../core/agent-context/IntentTracer.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function createContext(): Promise<{ context: AgentContext; root: string; pool: BufferedDbPool }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-intent-'));
  setDbPath(path.join(root, 'intent.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'intent-user', 'intent-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'intent-user');
  return { context, root, pool };
}

async function runTests(): Promise<void> {
  const { context, root } = await createContext();
  const correlationId = 'run-123';

  try {
    await assert.rejects(
      () =>
        context.storage.store({
          content: 'before-start',
          correlationId,
        }),
      LifecycleStateError
    );

    await context.start();

    await context.storage.store({
      content: 'intent payload',
      namespace: 'scratchpad',
      correlationId,
    });

    const search = await context.query.search({
      text: 'intent',
      limit: 5,
      correlationId,
    });
    assert.ok(Array.isArray(search.items));

    const { traces } = await context.audit.traces({ limit: 20, correlationId });
    assert.ok(traces.length >= 2, 'expected traced capability calls');
    const succeeded = traces.filter((trace) => trace.status === 'succeeded');
    assert.ok(succeeded.length >= 2);
    for (const trace of succeeded) {
      assert.ok(trace.latencyMs !== undefined && trace.latencyMs >= 0);
      assert.ok(trace.substrateEffects && trace.substrateEffects.length > 0);
      assert.strictEqual(trace.correlationId, correlationId);
    }

    const health = await context.health();
    assert.ok(health.intent);
    assert.ok(health.intent.recentIntentCount >= 2);
    assert.strictEqual(typeof health.intent.averageIntentLatencyMs, 'number');
    assert.ok(health.intent.traceBufferSize > 0);
    assert.ok(health.intent.perCapabilityIntentCounts.storage >= 1);
    assert.ok(health.intent.perCapabilityIntentCounts.query >= 1);

    await assert.rejects(
      () => context.storage.store({ content: '', correlationId }),
      (error: unknown) => error instanceof AgentGitError && error.code === 'INVALID_ARGUMENT'
    );
    const { traces: failureTraces } = await context.audit.traces({ limit: 5 });
    const failed = failureTraces.find((trace) => trace.status === 'failed');
    assert.ok(failed);
    assert.strictEqual(failed?.errorCode, 'INVALID_ARGUMENT');

    const postFailureHealth = await context.health();
    assert.ok(postFailureHealth.intent.failedIntentCount >= 1);

    context.enableDurableIntentTraces();
    await context.flush();

    await context.stop();
    await assert.rejects(
      () => context.audit.traces({ limit: 1 }),
      LifecycleStateError
    );

    const durable = await createContext();
    try {
      await durable.context.start();
      durable.context.enableDurableIntentTraces();
      await durable.context.storage.store({ content: 'durable trace', correlationId: 'durable-1' });
      await durable.context.flush();
      await durable.pool.flush();
      const records = await durable.pool.selectWhere('audit_events', [
        { column: 'type', value: 'intent_trace' },
      ]);
      assert.ok(records.length >= 1, 'durable traces should persist through BufferedDbPool');
    } finally {
      await durable.context.stop();
      fs.rmSync(durable.root, { recursive: true, force: true });
    }

    const tracerSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../core/agent-context/IntentTracer.ts'),
      'utf8'
    );
    assert.ok(!tracerSource.includes('writeFileSync'));
    assert.ok(!tracerSource.includes('writeFile('));
    assert.ok(!tracerSource.includes('trace_queue'));
    assert.ok(!tracerSource.includes('intent_queue'));

    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const forbidden of ['trace_queue.db', 'intent_queue.db']) {
      assert.ok(!fs.existsSync(path.join(root, forbidden)));
      assert.ok(!fs.existsSync(path.join(packageRoot, forbidden)));
    }

    const probe = new IntentTracer('probe-user');
    probe.createIntent({
      capability: 'storage',
      operation: 'probe',
      inputSummary: {},
      expectedEffects: ['probe'],
    });
    assert.ok(probe.health().recentIntentCount >= 1);
  } finally {
    if (context['lifecycleState'] !== 'stopped') {
      await context.stop();
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('intent-routing.test failed:', error);
    process.exit(1);
  });
