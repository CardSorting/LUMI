import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const banned = ['sovereign', 'vitality', 'oracle', 'godmode', 'hyper-cognition', 'industrial state'];
const publicApi = fs.readFileSync(path.join(__dirname, '../core/public-api.ts'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
const combined = publicApi + index;

for (const word of banned) {
  assert.ok(!combined.toLowerCase().includes(word), `experimental name leaked publicly: ${word}`);
}

console.log('no-experimental-public-names: OK');
