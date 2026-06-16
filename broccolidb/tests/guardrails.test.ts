import assert from 'node:assert';
import { InvariantEngine } from '../core/agent-context/InvariantEngine.js';

async function runTest() {
  const engine = new InvariantEngine(process.cwd());
  const violations = await engine.auditInvariants();
  assert.deepStrictEqual(violations, []);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('guardrails.test failed:', error);
    process.exit(1);
  });
