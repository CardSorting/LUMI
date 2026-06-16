import assert from 'node:assert';
import { ExecutionBudgetManager, RuntimeBudgetExceededError } from '../core/orchestration/runtime/ExecutionBudgetManager.js';
import { DEFAULT_BUDGETS } from '../core/orchestration/runtime/types.js';
import type { ExecutionSession, MutationPlan } from '../core/orchestration/types.js';

function session(startedAt: number): ExecutionSession {
  return {
    sessionId: 'budget-sess',
    startedAt,
    intents: [],
    audits: [],
    repairPlans: [],
    executions: [],
    verifications: [],
    status: 'running',
  };
}

function smallPlan(): MutationPlan {
  return {
    planId: 'p',
    sessionId: 'budget-sess',
    createdAt: Date.now(),
    steps: [{ stepId: '1', directiveId: 'd', type: 'UPDATE_IMPORT_PATH', targetFile: 'a.ts', description: '', riskLevel: 'low' }],
    estimatedRisk: 'low',
    affectedFiles: ['a.ts'],
    rollbackStrategy: { kind: 'file-snapshot', snapshotIds: [], description: '' },
    requiredVerificationCommands: [],
    requiredApprovals: [],
    expectedInvariantChanges: [],
    sourceReportId: 'r',
    directives: [],
  };
}

async function runTest() {
  const mgr = new ExecutionBudgetManager();
  const budget = { ...DEFAULT_BUDGETS.production, maxDurationMs: 1000, maxDirectives: 2 };

  mgr.assertWithinBudget({ session: session(Date.now()), budget, plan: smallPlan() });

  assert.throws(
    () =>
      mgr.assertWithinBudget({
        session: session(Date.now() - 5000),
        budget,
        plan: smallPlan(),
      }),
    RuntimeBudgetExceededError
  );

  const bigPlan = { ...smallPlan(), steps: [{ ...smallPlan().steps[0] }, { ...smallPlan().steps[0] }, { ...smallPlan().steps[0] }] };
  assert.throws(
    () => mgr.assertWithinBudget({ session: session(Date.now()), budget, plan: bigPlan }),
    RuntimeBudgetExceededError
  );
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('execution-budget.test failed:', error);
    process.exit(1);
  });
