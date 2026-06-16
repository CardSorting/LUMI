import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TypeMirrorEngine } from '../core/policy/spider/TypeMirrorEngine.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-type-mirror-'));
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] })
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'bad.ts'), 'const x: number = "nope";\n');

  const mirror = new TypeMirrorEngine(root);
  const result = mirror.runTypeMirror(new Set(['src/bad.ts']));

  assert.strictEqual(result.compilerAvailable, true);
  assert.strictEqual(result.diagnosticsComplete, true);
  assert.ok(result.diagnosticCount > 0);
  assert.ok(result.diagnostics[0].message.length > 0);
  assert.strictEqual(result.commandUsed, 'typescript.createProgram');

  const noConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-no-tsconfig-'));
  const degraded = new TypeMirrorEngine(noConfigRoot).runTypeMirror();
  assert.strictEqual(degraded.compilerAvailable, false);
  assert.strictEqual(degraded.diagnosticsComplete, false);
  assert.ok(degraded.degradedReason);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(noConfigRoot, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-type-mirror.test failed:', error);
    process.exit(1);
  });
