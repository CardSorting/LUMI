import assert from 'node:assert';
import { RuntimeEventBus } from '../core/orchestration/runtime/RuntimeEventBus.js';

async function runTest() {
  const bus = new RuntimeEventBus();
  const received: string[] = [];

  bus.subscribe((event) => {
    received.push(event.kind);
  });

  bus.emit({ kind: 'SessionStarted', sessionId: 's-1', mode: 'ci', timestamp: Date.now() });
  bus.emit({ kind: 'ExecutionFailed', sessionId: 's-1', error: 'boom', timestamp: Date.now() });

  assert.deepStrictEqual(received, ['SessionStarted', 'ExecutionFailed']);
  assert.strictEqual(bus.getEvents('s-1').length, 2);
  assert.ok(bus.getRecentCritical().some((e) => e.kind === 'ExecutionFailed'));

  let sideEffect = false;
  bus.subscribe(() => {
    sideEffect = true;
  });
  bus.emit({ kind: 'BudgetExceeded', sessionId: 's-1', reason: 'maxDurationMs', timestamp: Date.now() });
  assert.strictEqual(sideEffect, true, 'subscribers receive events');
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-event-bus.test failed:', error);
    process.exit(1);
  });
