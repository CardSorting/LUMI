import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { AGENT_CONTEXT_CLASSIFICATIONS } from '../core/agent-context/classifications.js';
import { LifecycleStateError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

const OWNED_SERVICES = Object.entries(AGENT_CONTEXT_CLASSIFICATIONS)
  .filter(([, kind]) => kind === 'OWNED')
  .map(([name]) => name);

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-discipline-'));
  const dbPath = path.join(root, 'discipline.db');
  setDbPath(dbPath);

  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'discipline-user', 'discipline-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'discipline-user');

  assert.strictEqual(context['lifecycleState'], 'new');

  await assert.rejects(() => context.store('before-start'), LifecycleStateError);
  await assert.rejects(() => context.mutex.acquireLock('resource'), LifecycleStateError);
  await assert.rejects(() => context.cleanup.performGarbageCollection(), LifecycleStateError);
  await assert.rejects(() => context.lsp.ensureServer('typescript'), LifecycleStateError);

  await context.start();
  try {
    assert.strictEqual(context['lifecycleState'], 'started');

    const registry = await context.health();
    assert.strictEqual(registry.status, 'healthy');
    assert.strictEqual(registry.registry.active, true);

    for (const serviceName of ['db', 'storage', 'cleanup', 'mutex', 'lsp', 'coordinator']) {
      const serviceHealth = registry.registry.services[serviceName];
      assert.ok(serviceHealth, `missing health for ${serviceName}`);
      assert.strictEqual(typeof serviceHealth.name, 'string');
      assert.ok(['healthy', 'degraded', 'critical', 'stopped'].includes(serviceHealth.status));
      assert.strictEqual(serviceHealth.started, true);
    }

    const hash = await context.store('discipline payload');
    assert.strictEqual(await context.hydrate(hash), 'discipline payload');
    assert.ok(context.storage);
    assert.ok(context.telemetry);
    assert.ok(context.recovery);
    assert.ok(context.auditCapability);
    assert.ok(context.coordination);
    assert.ok(context.query);
    assert.ok(context.snapshots);
  } finally {
    await context.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  await assert.rejects(() => context.store('after-stop'), LifecycleStateError);
  await assert.rejects(() => context.mutex.acquireLock('resource'), LifecycleStateError);

  assert.deepStrictEqual(OWNED_SERVICES.sort(), [
    'CleanupService',
    'CoordinatorService',
    'LspService',
    'MutexService',
  ].sort());

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    if (!relative.endsWith('agent-context.ts') && !relative.includes('capabilities/')) {
      assert.ok(
        !content.includes('new StorageService('),
        `shadow StorageService in ${relative}`
      );
    }
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('agent-context-discipline.test failed:', error);
    process.exit(1);
  });
