import assert from 'node:assert';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';
import { RuntimeGraphStore } from '../core/orchestration/state/store/RuntimeGraphStore.js';

async function runTest() {
  const graph = new RuntimeStateGraph();
  const store = new RuntimeGraphStore({ graph });
  await store.start();

  const sessionId = 'store-sess-1';
  graph.recordSession({ sessionId, startedAt: Date.now(), status: 'running' });
  graph.recordAudit(sessionId, `session:${sessionId}`, {
    reportId: 'r-1',
    generatedAt: new Date().toISOString(),
    scope: 'all',
    health: { pure: true, graphNodeCount: 0, compilerDelegatedToLsp: true },
    verdict: 'fail',
    degraded: false,
    degradedReasons: [],
    entropy: 0,
    findings: [],
    structuralViolations: [],
    layerViolations: [],
    cycles: [],
    repairDirectives: [],
    diskParity: [],
    footprints: [],
    typeMirror: { compilerAvailable: false, diagnosticsComplete: false, diagnosticCount: 0, diagnostics: [] },
  } as any);

  const snap = await store.snapshot(sessionId, 'development');
  assert.ok(snap.snapshotId);
  assert.ok(snap.graphHash);
  assert.strictEqual(snap.nodeCount > 0, true);

  await store.stop();
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-graph-store.test failed:', e);
    process.exit(1);
  });
