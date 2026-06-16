import assert from 'node:assert';
import {
  lifecycleNotStartedError,
  lifecycleStoppedError,
  formatGuidance,
  GuidedError,
} from '../core/error-guidance.js';

const notStarted = lifecycleNotStartedError('ctx.query.search()');
assert.strictEqual(notStarted.code, 'LIFECYCLE_STATE_ERROR');
assert.ok(notStarted.message.includes('ctx.start()'));
assert.ok(notStarted.likelyCause.length > 10);
assert.ok(notStarted.suggestedFix.length > 10);
assert.ok(notStarted.docsPath.includes('errors'));

const stopped = lifecycleStoppedError('ctx.runtime.beginSession()');
const formatted = formatGuidance(stopped);
assert.ok(formatted.includes('Cause:'));
assert.ok(formatted.includes('Fix:'));
assert.ok(formatted.includes('Docs:'));

const err = new GuidedError(notStarted);
assert.strictEqual(err.code, 'LIFECYCLE_STATE_ERROR');
assert.ok(err.message.includes('AgentContext has not been started'));

console.log('error-message: OK');
