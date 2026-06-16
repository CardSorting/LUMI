import assert from 'node:assert';
import { RuntimeMigrationEngine } from '../core/orchestration/state/store/RuntimeMigrationEngine.js';
import { RUNTIME_GRAPH_SCHEMA_VERSION } from '../core/orchestration/state/store/types.js';

async function runTest() {
  const engine = new RuntimeMigrationEngine();
  const migrated = engine.migrate({
    schemaVersion: '28.0.0',
    sessionId: 'mig-sess',
    nodes: [],
    edges: [],
    graphHash: 'abc',
  });
  assert.strictEqual(migrated.schemaVersion, RUNTIME_GRAPH_SCHEMA_VERSION);
  assert.ok(engine.getStatus().includes('migrated'));

  assert.throws(() =>
    engine.migrate({
      schemaVersion: '1.0.0',
      sessionId: 'x',
      nodes: [],
      edges: [],
      graphHash: 'x',
    })
  );
}

runTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('runtime-migration.test failed:', e);
    process.exit(1);
  });
