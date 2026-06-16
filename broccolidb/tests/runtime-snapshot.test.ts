import assert from 'node:assert';
import { RuntimeGraphSerializer } from '../core/orchestration/state/store/RuntimeGraphSerializer.js';
import { RuntimeSnapshotStore } from '../core/orchestration/state/store/RuntimeSnapshotStore.js';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const store = new RuntimeSnapshotStore(new RuntimeGraphSerializer());
  const sessionId = 'snap-sess';
  graph.recordSession({ sessionId, startedAt: Date.now(), status: 'running' });

  const s1 = await store.save(graph, sessionId, 'ci');
  const s2 = await store.save(graph, sessionId, 'ci');
  assert.notStrictEqual(s1.snapshotId, s2.snapshotId);
  assert.strictEqual(s1.graphHash, s2.graphHash, 'deterministic hash for same graph');

  const loaded = await store.load(s1.snapshotId);
  assert.strictEqual(loaded.graph.graphHash, s1.graphHash);
  assert.strictEqual(loaded.snapshot.compressed, false);
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-snapshot.test failed:', e);
    process.exit(1);
  });
