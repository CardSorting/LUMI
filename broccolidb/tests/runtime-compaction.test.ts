import assert from 'node:assert';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';
import { RuntimeGraphSerializer } from '../core/orchestration/state/store/RuntimeGraphSerializer.js';
import { RuntimeSnapshotStore } from '../core/orchestration/state/store/RuntimeSnapshotStore.js';
import { RuntimeCompactor } from '../core/orchestration/state/store/RuntimeCompactor.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const sessionId = 'compact-sess';
  graph.recordSession({ sessionId, startedAt: Date.now(), status: 'completed' });
  graph.addNode('Audit', sessionId, 'audit', { reportId: 'r' });

  const compactor = new RuntimeCompactor(new RuntimeSnapshotStore(new RuntimeGraphSerializer()));
  const result = await compactor.compact(graph, sessionId, 'development');

  assert.strictEqual(result.replayable, true);
  assert.ok(result.snapshotId);
  assert.ok(result.afterNodes >= result.beforeNodes - 1);
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-compaction.test failed:', e);
    process.exit(1);
  });
