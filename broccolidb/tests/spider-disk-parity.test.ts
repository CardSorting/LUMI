import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SpiderEngine } from '../core/policy/SpiderEngine.js';
import { DiskParityEngine } from '../core/policy/spider/DiskParityEngine.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-parity-'));
  const filePath = 'core/foo.ts';
  const absolute = path.join(root, filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const content = 'export const X = 1;\n';
  fs.writeFileSync(absolute, content);

  const engine = new SpiderEngine(root);
  engine.buildGraph([{ filePath, content }]);

  const parityEngine = new DiskParityEngine(root);
  const clean = parityEngine.verifyDiskParity(engine.nodes);
  assert.strictEqual(clean[0].driftStatus, 'clean');
  assert.strictEqual(clean[0].diskHash, clean[0].graphHash);
  assert.ok(clean[0].diskHash.length === 64);

  fs.writeFileSync(absolute, 'export const X = 2;\n');
  const drifted = parityEngine.verifyDiskParity(engine.nodes);
  assert.strictEqual(drifted[0].driftStatus, 'drifted');
  assert.notStrictEqual(drifted[0].diskHash, drifted[0].graphHash);

  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-disk-parity.test failed:', error);
    process.exit(1);
  });
