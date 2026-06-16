import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../../');
const docFiles = [
  'docs/getting-started.md',
  'docs/public-api.md',
  'docs/errors.md',
  'docs/cli.md',
  'docs/examples.md',
  'docs/architecture/current.md',
  'broccolidb/API_STABILITY.md',
  'broccolidb/MIGRATION.md',
];

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const broken: string[] = [];

for (const rel of docFiles) {
  const full = path.join(repoRoot, rel);
  assert.ok(fs.existsSync(full), `doc must exist: ${rel}`);
  const content = fs.readFileSync(full, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(content))) {
    const target = m[1]!;
    if (target.startsWith('http') || target.startsWith('#')) continue;
    const resolved = path.resolve(path.dirname(full), target);
    if (!fs.existsSync(resolved)) {
      broken.push(`${rel} → ${target}`);
    }
  }
}

assert.strictEqual(broken.length, 0, `Broken doc links:\n${broken.join('\n')}`);
console.log('docs-link-check: OK', docFiles.length, 'files');
