import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SpiderEngine } from '../core/policy/SpiderEngine.js';
import { FootprintEngine } from '../core/policy/spider/FootprintEngine.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-footprint-'));
  const fileA = path.join(root, 'a.ts');
  const fileB = path.join(root, 'b.ts');
  fs.writeFileSync(fileA, 'export function alpha() { return 1; }\n');
  fs.writeFileSync(fileB, 'import { alpha } from "./a";\nexport const use = alpha();\n');

  const engine = new SpiderEngine(root);
  engine.buildGraph([
    { filePath: 'a.ts', content: fs.readFileSync(fileA, 'utf8') },
    { filePath: 'b.ts', content: fs.readFileSync(fileB, 'utf8') },
  ]);

  const footprintEngine = new FootprintEngine();
  const contentByPath = new Map([
    ['a.ts', fs.readFileSync(fileA, 'utf8')],
    ['b.ts', fs.readFileSync(fileB, 'utf8')],
  ]);
  const footprints = footprintEngine.computeFootprints(engine.nodes, contentByPath);

  assert.ok(footprints.length >= 1);
  const alpha = footprints.find((f) => f.symbolName === 'alpha');
  assert.ok(alpha);
  assert.strictEqual(alpha.astNormalizedHash.length, 64);
  assert.strictEqual(alpha.signatureHash.length, 64);
  assert.strictEqual(alpha.currentLocation, 'a.ts');
  assert.ok(alpha.importIdentity.includes('b.ts'));
  assert.ok(alpha.matchReason.length > 0);

  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-footprinting.test failed:', error);
    process.exit(1);
  });
