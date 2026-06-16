import assert from 'node:assert';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';
import { RuntimeOperator } from '../core/orchestration/state/RuntimeOperator.js';
import type { ExecutionSession } from '../core/orchestration/types.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const operator = new RuntimeOperator(graph);
  const sessionId = 'causal-sess';
  const sessionNodeId = graph.recordSession({ sessionId, startedAt: Date.now(), status: 'failed' });

  const execId = graph.recordExecution(sessionId, sessionNodeId, {
    executionId: 'ex-causal',
    planId: 'p-1',
    sessionId,
    startedAt: Date.now(),
    appliedSteps: [],
    skippedSteps: [],
    snapshotIds: [],
    status: 'failed',
    error: 'apply failed',
  });

  graph.recordFailure(sessionId, execId, 'execution_failed', 'apply failed');
  graph.recordRollback(sessionId, execId, 'execution_failed', ['src/a.ts']);

  const causal = operator.causalView(sessionId);
  assert.ok(causal.chains.length >= 1);

  const session: ExecutionSession = {
    sessionId,
    startedAt: Date.now(),
    intents: [],
    audits: [],
    repairPlans: [],
    executions: [],
    verifications: [],
    status: 'failed',
    failureReason: 'apply failed',
  };

  const explain = operator.explain(sessionId, {
    session,
    health: { status: 'degraded' } as any,
    runtimeMode: 'development',
    events: [],
  });
  assert.ok(explain.causalSummary.length > 0);
  assert.ok(explain.narrative.includes('failed'));
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-causal-view.test failed:', error);
    process.exit(1);
  });
