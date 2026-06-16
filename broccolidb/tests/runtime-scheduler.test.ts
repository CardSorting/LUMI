import assert from 'node:assert';
import { SessionQueue } from '../core/orchestration/runtime/SessionQueue.js';
import { RuntimeScheduler } from '../core/orchestration/runtime/RuntimeScheduler.js';
import { ConcurrencyGovernor } from '../core/orchestration/runtime/ConcurrencyGovernor.js';
import { ExecutionBudgetManager } from '../core/orchestration/runtime/ExecutionBudgetManager.js';
import { RuntimePolicyEngine } from '../core/orchestration/runtime/RuntimePolicyEngine.js';
import { DEFAULT_BUDGETS } from '../core/orchestration/runtime/types.js';
import type { ExecutionSession, MutationPlan } from '../core/orchestration/types.js';

function session(id: string, priority: ExecutionSession['priority'] = 'normal'): ExecutionSession {
  return {
    sessionId: id,
    startedAt: Date.now(),
    priority,
    intents: [],
    audits: [],
    repairPlans: [],
    executions: [],
    verifications: [],
    status: 'running',
  };
}

function plan(sessionId: string): MutationPlan {
  return {
    planId: 'p-1',
    sessionId,
    createdAt: Date.now(),
    steps: [
      {
        stepId: 's-1',
        directiveId: 'd-1',
        type: 'UPDATE_IMPORT_PATH',
        targetFile: 'a.ts',
        description: 'fix',
        riskLevel: 'low',
      },
    ],
    estimatedRisk: 'low',
    affectedFiles: ['a.ts'],
    rollbackStrategy: { kind: 'file-snapshot', snapshotIds: [], description: 'snap' },
    requiredVerificationCommands: ['gate'],
    requiredApprovals: [],
    expectedInvariantChanges: [],
    sourceReportId: 'r-1',
    directives: [],
  };
}

async function runTest() {
  const queue = new SessionQueue();
  const sessions = new Map<string, ExecutionSession>([
    ['s-low', session('s-low', 'low')],
    ['s-high', session('s-high', 'high')],
  ]);

  const concurrency = new ConcurrencyGovernor();
  concurrency.setMaxConcurrent(2);

  const scheduler = new RuntimeScheduler(
    queue,
    concurrency,
    new ExecutionBudgetManager(),
    new RuntimePolicyEngine(),
    () => 'development',
    (id) => sessions.get(id),
    (s) => DEFAULT_BUDGETS.development
  );

  scheduler.schedule({ plan: plan('s-low'), policy: 'autonomous_safe', priority: 'low' });
  scheduler.schedule({ plan: plan('s-high'), policy: 'autonomous_safe', priority: 'high' });

  const order: string[] = [];
  await scheduler.processAll(async (job) => {
    order.push(job.sessionId);
    return { execution: {} as any, session: sessions.get(job.sessionId)! };
  });

  assert.deepStrictEqual(order, ['s-high', 's-low'], 'high priority must execute before low (FIFO within priority)');
  assert.strictEqual(queue.length, 0);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-scheduler.test failed:', error);
    process.exit(1);
  });
