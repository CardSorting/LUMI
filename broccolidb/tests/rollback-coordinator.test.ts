import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RollbackCoordinator } from '../core/orchestration/RollbackCoordinator.js';
import { ExecutionTrace } from '../core/orchestration/ExecutionTrace.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-'));
  const file = path.join(root, 'src', 'file.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = 'export const A = 1;\n';
  fs.writeFileSync(file, original, 'utf8');

  const trace = new ExecutionTrace();
  const coordinator = new RollbackCoordinator(root, trace);
  const sessionId = 'sess-rb';

  const ids = coordinator.snapshotBefore(['src/file.ts'], sessionId);
  assert.strictEqual(ids.length, 1);

  fs.writeFileSync(file, 'export const B = 2;\n', 'utf8');
  assert.notStrictEqual(fs.readFileSync(file, 'utf8'), original);

  const result = coordinator.restore(ids, sessionId);
  assert.deepStrictEqual(result.restored, ['src/file.ts']);
  assert.deepStrictEqual(result.failed, []);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original);

  const events = trace.getEvents(sessionId);
  assert.ok(events.some((e) => e.kind === 'rollback_started'));
  assert.ok(events.some((e) => e.kind === 'rollback_completed'));

  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('rollback-coordinator.test failed:', error);
    process.exit(1);
  });
