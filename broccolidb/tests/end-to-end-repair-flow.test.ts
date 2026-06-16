import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { PolicyBlockedError } from '../core/orchestration/ApprovalPolicyEngine.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-repair-'));
  setDbPath(path.join(root, 'e2e.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'e2e-user', 'e2e-ws');
  workspace.setPhysicalPath(root);

  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  const provider = path.join(src, 'provider.ts');
  const consumer = path.join(src, 'consumer.ts');
  fs.writeFileSync(provider, 'export const Anchor = 1;\n');
  fs.writeFileSync(consumer, 'import { Anchor } from "./provider";\nexport const v = Anchor;\n');
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] })
  );

  const ctx = new AgentContext(workspace, pool, 'e2e-user');
  await ctx.start();

  try {
    const session = await ctx.runtime.beginSession({ taskId: 'repair-auth-flow' });
    const beforeProvider = fs.readFileSync(provider, 'utf8');

    const audit = await ctx.graph.spider.audit({
      scope: 'all',
      includeRepairDirectives: true,
      includeTypes: true,
    });
    ctx.runtime.recordAudit(session.sessionId, audit);
    assert.strictEqual(fs.readFileSync(provider, 'utf8'), beforeProvider, 'audit must not mutate');

    const gate = await ctx.graph.spider.gate({ scope: 'changed-files' });
    if (gate.blocked) {
      const plan = ctx.runtime.planRepairs({
        audit,
        policy: 'human_approval_required',
        sessionId: session.sessionId,
      });

      const preview = ctx.runtime.preview(plan, 'human_approval_required');
      assert.ok(preview.narrative.length > 0);
      assert.strictEqual(preview.policyDecision.allowed, false);

      if (plan.steps.length > 0 && plan.estimatedRisk === 'high') {
        await assert.rejects(
          () => ctx.runtime.execute({ plan, policy: 'autonomous_safe' }),
          PolicyBlockedError
        );
      }

      const traces = ctx.runtime.getTrace(session.sessionId);
      assert.ok(traces.some((t) => t.kind === 'plan_created'));
      assert.ok(traces.some((t) => t.kind === 'audit_recorded'));
    }

    const health = ctx.runtime.getRuntimeHealth();
    assert.ok(typeof health.activeSessions === 'number');
    assert.ok(typeof health.rollbackCount === 'number');
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('end-to-end-repair-flow.test failed:', error);
    process.exit(1);
  });
