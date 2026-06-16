import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliIndex = fs.readFileSync(path.join(__dirname, '../cli/index.ts'), 'utf8');

const requiredCommands = ['health', 'spider', 'runtime', 'init', 'serve', 'status'];
for (const cmd of requiredCommands) {
  assert.ok(cliIndex.includes(`'${cmd}'`), `CLI must support ${cmd}`);
}

const commandModules = ['commands/health.ts', 'commands/spider.ts', 'commands/runtime.ts'];
for (const mod of commandModules) {
  assert.ok(fs.existsSync(path.join(__dirname, '../cli', mod)), `${mod} must exist`);
  const src = fs.readFileSync(path.join(__dirname, '../cli', mod), 'utf8');
  assert.ok(src.includes('parseFormat'), `${mod} must support output formats`);
}

console.log('cli-smoke: OK');
