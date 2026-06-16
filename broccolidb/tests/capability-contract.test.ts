import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { AgentGitError, LifecycleStateError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

const CAPABILITY_NAMES = [
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
] as const;

type CapabilityName = (typeof CAPABILITY_NAMES)[number];

async function createContext(): Promise<{ context: AgentContext; root: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-capability-'));
  setDbPath(path.join(root, 'capability.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'cap-user', 'cap-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'cap-user');
  return { context, root };
}

async function assertLifecycleGuards(
  name: CapabilityName,
  invoke: (context: AgentContext) => Promise<unknown>
): Promise<void> {
  const { context, root } = await createContext();
  try {
    await assert.rejects(() => invoke(context), LifecycleStateError);
    await context.start();
    await invoke(context);
    const health = await context[name].health();
    assert.strictEqual(health.name, name);
    assert.strictEqual(health.started, true);
    assert.ok(Array.isArray(health.dependencies));
    assert.ok(health.metrics);
    assert.strictEqual(typeof health.metrics.callCount, 'number');
    await context.stop();
    await assert.rejects(() => invoke(context), LifecycleStateError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function runContractTests(): Promise<void> {
  await assertLifecycleGuards('storage', async (ctx) => {
    const result = await ctx.storage.store({ content: 'contract payload' });
    assert.strictEqual(typeof result.hash, 'string');
    assert.strictEqual(result.namespace, 'default');
    const hydrated = await ctx.storage.hydrate({ hash: result.hash });
    assert.strictEqual(hydrated.content, 'contract payload');
  });

  const { context, root } = await createContext();
  try {
    await context.start();
    await assert.rejects(
      () => context.storage.store({ content: '' }),
      (error: unknown) => error instanceof AgentGitError && error.code === 'INVALID_ARGUMENT'
    );
    await assert.rejects(
      () => context.storage.hydrate({ hash: 'not-a-hash' }),
      (error: unknown) => error instanceof AgentGitError && error.code === 'INVALID_ARGUMENT'
    );
  } finally {
    await context.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }

  await assertLifecycleGuards('telemetry', async (ctx) => {
    const result = await ctx.telemetry.record({
      usage: { promptTokens: 1, completionTokens: 2 },
      agentId: 'cap-agent',
    });
    assert.strictEqual(result.recorded, true);
    assert.ok(result.telemetryId);
  });

  await assertLifecycleGuards('recovery', async (ctx) => {
    const result = await ctx.recovery.recover({ mode: 'standard' });
    assert.strictEqual(result.recovered, true);
  });

  await assertLifecycleGuards('audit', async (ctx) => {
    const result = await ctx.audit.invariants();
    assert.ok(Array.isArray(result.violations));
  });

  await assertLifecycleGuards('coordination', async (ctx) => {
    const result = await ctx.coordination.acquireLock({ resource: 'contract-lock' });
    assert.strictEqual(typeof result.acquired, 'boolean');
  });

  await assertLifecycleGuards('query', async (ctx) => {
    const result = await ctx.query.search({ text: 'contract', limit: 5 });
    assert.ok(Array.isArray(result.items));
    assert.strictEqual(typeof result.total, 'number');
  });

  await assertLifecycleGuards('snapshots', async (ctx) => {
    const result = await ctx.snapshots.create({ metadata: { source: 'contract-test' } });
    assert.strictEqual(typeof result.hash, 'string');
  });

  await assertLifecycleGuards('graph', async (ctx) => {
    const result = await ctx.graph.addKnowledge({
      kbId: 'contract-node',
      type: 'fact',
      content: 'contract graph node',
    });
    assert.strictEqual(result.kbId, 'contract-node');
  });

  await assertLifecycleGuards('reasoning', async (ctx) => {
    const result = await ctx.reasoning.detectContradictions({ startIds: [] });
    assert.ok(Array.isArray(result.reports));
  });

  await assertLifecycleGuards('tasks', async (ctx) => {
    const result = ctx.tasks.getScratchpadPath();
    assert.strictEqual(typeof result.path, 'string');
  });

  await assertLifecycleGuards('scratchpad', async (ctx) => {
    const result = await ctx.scratchpad.list();
    assert.ok(Array.isArray(result.files));
  });

  await assertLifecycleGuards('mailbox', async (ctx) => {
    const result = await ctx.mailbox.pollInbox({ agentId: 'cap-agent' });
    assert.ok(Array.isArray(result.messages));
  });

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const capabilityDir = path.join(packageRoot, 'core/agent-context/capabilities');
  const forbiddenPatterns = [
    { regex: /Promise\s*<\s*any\s*>/, label: 'Promise<any>' },
    { regex: /\bwriteFileSync\b/, label: 'direct filesystem write' },
    { regex: /\bnew Database\s*\(/, label: 'direct Database construction' },
    { regex: /\bnew StorageService\s*\(/, label: 'direct StorageService construction' },
    { regex: /\bshutdown\s*\(/, label: 'shutdown()' },
    { regex: /\bpasteStore\b/, label: 'pasteStore' },
    { regex: /\bget db\s*\(/, label: 'db getter' },
    { regex: /\bdispose\s*\(/, label: 'dispose()' },
  ];

  const capabilityBaseSource = fs.readFileSync(
    path.join(packageRoot, 'core/agent-context/CapabilityBase.ts'),
    'utf8'
  );
  assert.ok(capabilityBaseSource.includes('IntentTracer'), 'CapabilityBase must route through IntentTracer');

  for (const file of fs.readdirSync(capabilityDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(capabilityDir, file), 'utf8');
    assert.ok(content.includes('extends CapabilityBase'), `${file} must extend CapabilityBase`);
    assert.ok(content.includes('readonly dependencies'), `${file} must declare dependencies`);
    assert.ok(!content.includes('trace_queue'), `${file} must not reference trace_queue`);
    assert.ok(!content.includes('intent_queue'), `${file} must not reference intent_queue`);
    for (const pattern of forbiddenPatterns) {
      assert.ok(!pattern.regex.test(content), `${file} violates guardrail: ${pattern.label}`);
    }
  }

  const docsDir = path.resolve(packageRoot, '..', 'docs/api/capabilities');
  for (const name of CAPABILITY_NAMES) {
    const docPath = path.join(docsDir, `${name}.md`);
    assert.ok(fs.existsSync(docPath), `missing capability doc: docs/api/capabilities/${name}.md`);
  }

  assert.ok(
    fs.existsSync(path.resolve(packageRoot, '..', 'docs/architecture/broccolidb-v25-intent-routing.md'))
  );
  assert.ok(fs.existsSync(path.resolve(packageRoot, '..', 'docs/api/intent-tracing.md')));
}

runContractTests()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('capability-contract.test failed:', error);
    process.exit(1);
  });
