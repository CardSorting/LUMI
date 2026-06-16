import assert from 'node:assert';
import { RuntimeIntegrityVerifier } from '../core/orchestration/state/store/RuntimeIntegrityVerifier.js';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const verifier = new RuntimeIntegrityVerifier();
  const sessionId = 'int-sess';
  const sessionNode = graph.recordSession({ sessionId, startedAt: Date.now(), status: 'running' });

  graph.addNode('Execution', sessionId, 'orphan exec', { executionId: 'ex-1' }, 'execution:ex-1');
  const report = verifier.verify(graph, sessionId);
  assert.ok(report.violations.some((v) => v.diagnosticId === 'RTG-003'));

  graph.recordExecution(sessionId, sessionNode, {
    executionId: 'ex-2',
    planId: 'missing-plan',
    sessionId,
    startedAt: Date.now(),
    appliedSteps: [],
    skippedSteps: [],
    snapshotIds: [],
    status: 'completed',
  });
  const report2 = verifier.verify(graph, sessionId);
  assert.ok(report2.violations.some((v) => v.diagnosticId === 'RTG-003'));
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-integrity.test failed:', e);
    process.exit(1);
  });
