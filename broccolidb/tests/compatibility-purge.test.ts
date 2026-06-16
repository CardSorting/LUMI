import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { COMPATIBILITY_EXCEPTIONS } from '../core/agent-context/compatibility-purge.js';

const FORBIDDEN_PUBLIC_PATTERNS = [
  /\bshutdown\s*\(/,
  /\bpasteStore\b/,
  /\bget db\s*\(/,
  /\bdispose\s*\(/,
  /\bget graphService\s*\(/,
  /\bget reasoningService\s*\(/,
  /\bget taskService\s*\(/,
  /\bget storageService\s*\(/,
];

async function runTest() {
  for (const exception of COMPATIBILITY_EXCEPTIONS) {
    assert.ok(exception.deletionDate, `Compatibility exception '${exception.symbol}' must include deletionDate`);
    assert.ok(exception.reason, `Compatibility exception '${exception.symbol}' must include reason`);
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const agentContextSource = fs.readFileSync(path.join(packageRoot, 'core/agent-context.ts'), 'utf8');

  for (const pattern of FORBIDDEN_PUBLIC_PATTERNS) {
    assert.ok(!pattern.test(agentContextSource), `Forbidden legacy pattern remains in AgentContext: ${pattern}`);
  }

  const capabilityDir = path.join(packageRoot, 'core/agent-context/capabilities');
  for (const file of fs.readdirSync(capabilityDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(capabilityDir, file), 'utf8');
    assert.ok(content.includes('extends CapabilityBase'), `${file} must extend CapabilityBase`);
    assert.ok(!content.includes('Promise<any>'), `${file} must not return Promise<any>`);
    assert.ok(!content.includes('new StorageService('), `${file} must not construct StorageService`);
    assert.ok(!content.includes('new BufferedDbPool('), `${file} must not construct BufferedDbPool`);
    assert.ok(!content.includes('new Database('), `${file} must not construct Database`);
    assert.ok(!content.includes('writeFileSync'), `${file} must not write files directly`);
    assert.ok(!content.includes('shutdown('), `${file} must not expose shutdown()`);
    assert.ok(!content.includes('pasteStore'), `${file} must not reference pasteStore`);
    assert.ok(!content.includes('trace_queue'), `${file} must not reference trace_queue`);
    assert.ok(!content.includes('intent_queue'), `${file} must not reference intent_queue`);
    assert.ok(!content.includes('startAll('), `${file} must not start lifecycle directly`);
    assert.ok(!content.includes('stopAll('), `${file} must not stop lifecycle directly`);
  }

  const allowed = new Set([
    'constructor',
    'userId',
    'start',
    'stop',
    'flush',
    'health',
    'enableDurableIntentTraces',
    'storage',
    'telemetry',
    'recovery',
    'audit',
    'coordination',
    'query',
    'snapshots',
    'graph',
    'reasoning',
    'tasks',
    'scratchpad',
    'mailbox',
  ]);

  const internalRuntimeMembers = new Set([
    'assertOperational',
    'getCacheStats',
    'collectCapabilityHealth',
    'auditCompatibilityBridges',
    '_push',
    '_pushBatch',
  ]);
  for (const member of Object.getOwnPropertyNames(AgentContext.prototype)) {
    if (member.startsWith('_') || internalRuntimeMembers.has(member)) continue;
    assert.ok(allowed.has(member), `Unexpected public AgentContext API: ${member}`);
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('compatibility-purge.test failed:', error);
    process.exit(1);
  });
