import assert from 'node:assert';
import { ApprovalPolicyEngine, PolicyBlockedError } from '../core/orchestration/ApprovalPolicyEngine.js';
import type { MutationPlan } from '../core/orchestration/types.js';

function plan(risk: MutationPlan['estimatedRisk']): MutationPlan {
  return {
    planId: 'p-1',
    sessionId: 's-1',
    createdAt: Date.now(),
    steps: [
      {
        stepId: 'st-1',
        directiveId: 'd-1',
        type: 'UPDATE_IMPORT_PATH',
        targetFile: 'a.ts',
        description: 'fix',
        riskLevel: risk,
      },
    ],
    estimatedRisk: risk,
    affectedFiles: ['a.ts'],
    rollbackStrategy: { kind: 'file-snapshot', snapshotIds: [], description: 'snap' },
    requiredVerificationCommands: ['await ctx.graph.spider.gate({ scope: "changed-files" })'],
    requiredApprovals: [],
    expectedInvariantChanges: [],
    sourceReportId: 'r-1',
    directives: [],
  };
}

async function runTest() {
  const engine = new ApprovalPolicyEngine();

  assert.throws(() => engine.assertAllowed(plan('low'), 'readonly'), PolicyBlockedError);
  assert.throws(() => engine.assertAllowed(plan('low'), 'production_locked'), PolicyBlockedError);

  const human = engine.evaluate(plan('low'), 'human_approval_required');
  assert.strictEqual(human.allowed, false);

  const approved = engine.assertAllowed(plan('low'), 'human_approval_required', 'operator-1');
  assert.strictEqual(approved.allowed, true);

  const safeBlocked = engine.evaluate(plan('high'), 'autonomous_safe');
  assert.strictEqual(safeBlocked.allowed, false);
  assert.ok(safeBlocked.reasons.some((r) => r.includes('high')));

  const safeOk = engine.assertAllowed(plan('low'), 'autonomous_safe');
  assert.strictEqual(safeOk.allowed, true);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('approval-policy.test failed:', error);
    process.exit(1);
  });
