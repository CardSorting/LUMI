import assert from 'node:assert';
import { RuntimeGraphSerializer } from '../core/orchestration/state/store/RuntimeGraphSerializer.js';

async function runTest() {
  const serializer = new RuntimeGraphSerializer();
  const graph = serializer.serialize('corrupt-sess', [
    {
      id: 'n1',
      kind: 'Session',
      sessionId: 'corrupt-sess',
      timestamp: Date.now(),
      label: 's',
      data: {},
    },
  ], []);

  const tampered = { ...graph, graphHash: 'deadbeef' };
  assert.throws(() => serializer.deserialize(tampered), /RTG-005/);

  const ok = serializer.deserialize(graph);
  assert.strictEqual(ok.sessionId, 'corrupt-sess');
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-corruption-recovery.test failed:', e);
    process.exit(1);
  });
