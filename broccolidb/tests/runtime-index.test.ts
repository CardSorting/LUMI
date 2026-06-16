import assert from 'node:assert';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';
import { RuntimeIndex } from '../core/orchestration/state/store/RuntimeIndex.js';
import { RuntimeOperator } from '../core/orchestration/state/RuntimeOperator.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const index = new RuntimeIndex();
  const sessionId = 'idx-sess';
  const session = {
    sessionId,
    startedAt: Date.now(),
    taskId: 'task-auth',
    intents: [],
    audits: [],
    repairPlans: [],
    executions: [],
    verifications: [],
    status: 'running' as const,
  };

  graph.recordSession(session);
  graph.addNode('RepairDirective', sessionId, 'dir', { type: 'UPDATE_IMPORT_PATH', targetFile: 'a.ts' });
  index.indexSession(session, graph);

  assert.deepStrictEqual(index.sessionsByTask('task-auth'), [sessionId]);
  assert.deepStrictEqual(index.executionsByDirective('UPDATE_IMPORT_PATH'), [sessionId]);
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-index.test failed:', e);
    process.exit(1);
  });
