import assert from 'node:assert';
import { ConcurrencyGovernor } from '../core/orchestration/runtime/ConcurrencyGovernor.js';
import { LifecycleStateError } from '../core/errors.js';

async function runTest() {
  const governor = new ConcurrencyGovernor();
  governor.setMaxConcurrent(1);

  governor.acquire('s-1');
  assert.throws(() => governor.acquire('s-2'), LifecycleStateError);
  assert.strictEqual(governor.utilization, 1);

  governor.release();
  assert.strictEqual(governor.active, 0);

  governor.setMaxConcurrent(0);
  assert.throws(() => governor.acquire('s-3'), LifecycleStateError);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('concurrency-governor.test failed:', error);
    process.exit(1);
  });
