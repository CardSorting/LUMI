import assert from 'node:assert';
import { SessionJournal } from '../core/orchestration/runtime/SessionJournal.js';

async function runTest() {
  const journal = new SessionJournal();
  const sessionId = 'journal-sess';

  journal.record(sessionId, 'session_started', { taskId: 't' });
  journal.record(sessionId, 'audit', { reportId: 'r-1' });
  journal.record(sessionId, 'plan', { planId: 'p-1' });
  journal.record(sessionId, 'execution', { executionId: 'ex-1' });
  journal.record(sessionId, 'verification', { passed: true });
  journal.record(sessionId, 'completion', {});

  const entries = journal.getEntries(sessionId);
  assert.strictEqual(entries.length, 6);
  assert.strictEqual(entries[0].kind, 'session_started');
  assert.strictEqual(entries[entries.length - 1].kind, 'completion');

  journal.record('other', 'audit', {});
  assert.strictEqual(journal.getEntries(sessionId).length, 6);
  assert.strictEqual(journal.getAll().length, 7);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('session-journal.test failed:', error);
    process.exit(1);
  });
