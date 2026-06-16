import assert from 'node:assert';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';
import { RuntimeGraphSerializer } from '../core/orchestration/state/store/RuntimeGraphSerializer.js';
import { RuntimeSnapshotStore } from '../core/orchestration/state/store/RuntimeSnapshotStore.js';
import { RuntimeReplayHydrator } from '../core/orchestration/state/store/RuntimeReplayHydrator.js';
import { RuntimeMigrationEngine } from '../core/orchestration/state/store/RuntimeMigrationEngine.js';
import { RuntimeIntegrityVerifier } from '../core/orchestration/state/store/RuntimeIntegrityVerifier.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const sessionId = 'replay-hydrate';
  graph.recordSession({ sessionId, startedAt: Date.now(), status: 'running' });

  const snapshotStore = new RuntimeSnapshotStore(new RuntimeGraphSerializer());
  await snapshotStore.save(graph, sessionId, 'forensic');

  const hydrator = new RuntimeReplayHydrator(
    snapshotStore,
    new RuntimeGraphSerializer(),
    new RuntimeMigrationEngine(),
    new RuntimeIntegrityVerifier()
  );

  const result = await hydrator.hydrate(graph, sessionId, { mode: 'forensic' });
  assert.strictEqual(result.readonly, true);
  assert.strictEqual(result.sessionId, sessionId);
  assert.ok(result.graph.nodes.length >= 1);

  const timeline = hydrator.projectForMode({ ...result, mode: 'timeline' });
  assert.ok('nodes' in timeline);
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-replay-hydration.test failed:', e);
    process.exit(1);
  });
