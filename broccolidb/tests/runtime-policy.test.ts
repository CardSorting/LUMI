import assert from 'node:assert';
import { RuntimePolicyEngine, RuntimePolicyViolationError } from '../core/orchestration/runtime/RuntimePolicyEngine.js';
import { DEFAULT_BUDGETS } from '../core/orchestration/runtime/types.js';
import type { ExecutionSession, MutationPlan } from '../core/orchestration/types.js';

function plan(steps: MutationPlan['steps']): MutationPlan {
  return {
    planId: 'p',
    sessionId: 's',
    createdAt: Date.now(),
    steps,
    estimatedRisk: 'low',
    affectedFiles: ['a.ts'],
    rollbackStrategy: { kind: 'none', snapshotIds: [], description: '' },
    requiredVerificationCommands: ['gate'],
    requiredApprovals: [],
    expectedInvariantChanges: [],
    sourceReportId: 'r',
    directives: [],
  };
}

function sess(): ExecutionSession {
  return {
    sessionId: 's',
    startedAt: Date.now(),
    intents: [],
    audits: [],
    repairPlans: [],
    executions: [],
    verifications: [],
    status: 'running',
  };
}

async function runTest() {
  const engine = new RuntimePolicyEngine();

  assert.throws(
    () =>
      engine.assertExecutionAllowed({
        mode: 'readonly',
        plan: plan([
          { stepId: '1', directiveId: 'd', type: 'UPDATE_IMPORT_PATH', targetFile: 'a.ts', description: '', riskLevel: 'low' },
        ]),
        session: sess(),
        budget: DEFAULT_BUDGETS.readonly,
        policy: 'readonly',
      }),
    RuntimePolicyViolationError
  );

  assert.throws(
    () =>
      engine.assertExecutionAllowed({
        mode: 'ci',
        plan: plan([
          { stepId: '1', directiveId: 'd', type: 'BREAK_CYCLE_BY_INTERFACE', targetFile: 'a.ts', description: '', riskLevel: 'high' },
        ]),
        session: sess(),
        budget: DEFAULT_BUDGETS.ci,
        policy: 'ci_gate_only',
      }),
    RuntimePolicyViolationError
  );

  engine.assertExecutionAllowed({
    mode: 'development',
    plan: plan([
      { stepId: '1', directiveId: 'd', type: 'UPDATE_IMPORT_PATH', targetFile: 'a.ts', description: '', riskLevel: 'low' },
    ]),
    session: sess(),
    budget: DEFAULT_BUDGETS.development,
    policy: 'autonomous_safe',
  });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-policy.test failed:', error);
    process.exit(1);
  });
