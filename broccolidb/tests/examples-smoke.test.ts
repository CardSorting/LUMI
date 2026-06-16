import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, '../examples');
const examples = [
  'basic-context.ts',
  'lifecycle-error.ts',
  'spider-gate.ts',
  'repair-flow.ts',
  'runtime-replay.ts',
  'health-check.ts',
  'ci-gate.ts',
];

for (const file of examples) {
  const full = path.join(examplesDir, file);
  assert.ok(fs.existsSync(full), `${file} must exist`);
  const result = spawnSync('npx', ['tsx', full], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status === null) {
    assert.fail(`${file} timed out`);
  }
  if (file === 'ci-gate.ts') {
    assert.ok(result.status <= 1, `${file} unexpected exit ${result.status}`);
  } else {
    assert.strictEqual(result.status, 0, `${file} failed:\n${result.stderr}\n${result.stdout}`);
  }
  assert.ok(result.stdout.length > 0, `${file} should print output`);
}
console.log('examples-smoke: OK', examples.length);
