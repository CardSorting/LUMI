import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { AGENT_CONTEXT_CLASSIFICATIONS } from '../core/agent-context/classifications.js';
import { COMPATIBILITY_EXCEPTIONS } from '../core/agent-context/compatibility-purge.js';
import { LifecycleStateError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

const OWNED_SERVICES = Object.entries(AGENT_CONTEXT_CLASSIFICATIONS)
  .filter(([, kind]) => kind === 'OWNED_SERVICE')
  .map(([name]) => name);

const ALLOWED_PUBLIC_MEMBERS = new Set([
  'constructor',
  'userId',
  'start',
  'stop',
  'flush',
  'health',
  'enableDurableIntentTraces',
  'storage',
  'telemetry',
  'recovery',
  'audit',
  'coordination',
  'query',
  'snapshots',
  'graph',
  'reasoning',
  'tasks',
  'scratchpad',
  'mailbox',
]);

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-discipline-'));
  const dbPath = path.join(root, 'discipline.db');
  setDbPath(dbPath);

  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'discipline-user', 'discipline-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'discipline-user');

  assert.strictEqual(context['lifecycleState'], 'new');

  await assert.rejects(() => context.storage.store({ content: 'before-start' }), LifecycleStateError);
  await assert.rejects(
    () => context.coordination.acquireLock({ resource: 'resource' }),
    LifecycleStateError
  );
  await assert.rejects(() => context.recovery.performGarbageCollection(), LifecycleStateError);
  await assert.rejects(async () => context.graph.spider.auditStructure(), LifecycleStateError);

  await context.start();
  try {
    assert.strictEqual(context['lifecycleState'], 'started');

    const health = await context.health();
    assert.strictEqual(health.status, 'healthy');
    assert.strictEqual(health.registry.active, true);
    assert.ok(health.capabilities.storage?.started);

    for (const serviceName of ['db', 'storage', 'cleanup', 'mutex', 'lsp', 'coordinator']) {
      const serviceHealth = health.registry.services[serviceName];
      assert.ok(serviceHealth, `missing health for ${serviceName}`);
      assert.strictEqual(serviceHealth.started, true);
    }

    const { hash } = await context.storage.store({ content: 'discipline payload' });
    const hydrated = await context.storage.hydrate({ hash });
    assert.strictEqual(hydrated.content, 'discipline payload');

    const storageHealth = await context.storage.health();
    assert.strictEqual(storageHealth.name, 'storage');
    assert.strictEqual(storageHealth.started, true);
    assert.ok(storageHealth.dependencies.includes('StorageService'));
    for (const cap of [
      'storage',
      'telemetry',
      'recovery',
      'audit',
      'coordination',
      'query',
      'snapshots',
      'graph',
      'reasoning',
      'tasks',
      'scratchpad',
      'mailbox',
    ] as const) {
      assert.ok(context[cap], `missing capability getter: ${cap}`);
    }
  } finally {
    await context.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  await assert.rejects(() => context.storage.store({ content: 'after-stop' }), LifecycleStateError);
  await assert.rejects(
    () => context.coordination.acquireLock({ resource: 'resource' }),
    LifecycleStateError
  );

  assert.deepStrictEqual(
    OWNED_SERVICES.sort(),
    ['BufferedDbPool', 'CleanupService', 'CoordinatorService', 'LspService', 'MutexService', 'StorageService'].sort()
  );

  for (const exception of COMPATIBILITY_EXCEPTIONS) {
    assert.ok(exception.deletionDate, `exception ${exception.symbol} missing deletionDate`);
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const agentContextFile = path.join(packageRoot, 'core/agent-context.ts');
  const agentContextSource = fs.readFileSync(agentContextFile, 'utf8');
  assert.ok(!agentContextSource.includes('shutdown('));
  assert.ok(!agentContextSource.includes('pasteStore'));
  assert.ok(!agentContextSource.includes('get db()'));

  const publicMembers = Object.getOwnPropertyNames(AgentContext.prototype).filter(
    (name) => !name.startsWith('_')
  );
  const internalRuntimeMembers = new Set([
    'assertOperational',
    'getCacheStats',
    'collectCapabilityHealth',
    'auditCompatibilityBridges',
    '_push',
    '_pushBatch',
  ]);
  for (const member of publicMembers) {
    if (internalRuntimeMembers.has(member)) continue;
    assert.ok(ALLOWED_PUBLIC_MEMBERS.has(member), `forbidden public AgentContext member: ${member}`);
  }

  const agentContextDir = path.join(packageRoot, 'core/agent-context');
  const sourceFiles = fs
    .readdirSync(agentContextDir, { recursive: true })
    .filter((file) => typeof file === 'string' && file.endsWith('.ts'))
    .map((file) => path.join(agentContextDir, file as string));

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relative = path.relative(packageRoot, file);
    if (relative.endsWith('InvariantEngine.ts')) continue;
    assert.ok(!content.includes('pasteStore'), `pasteStore remains in ${relative}`);
    if (!relative.endsWith('agent-context.ts')) {
      assert.ok(!content.includes('shutdown('), `shutdown() remains in ${relative}`);
    }
    if (
      relative.includes('capabilities/') &&
      content.includes('new ') &&
      (content.includes('Service(') || content.includes('StorageService('))
    ) {
      assert.fail(`capability constructs owned service in ${relative}`);
    }
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('agent-context-discipline.test failed:', error);
    process.exit(1);
  });
