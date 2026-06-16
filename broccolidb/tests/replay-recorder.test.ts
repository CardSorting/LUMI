import assert from 'node:assert';
import { ReplayRecorder } from '../core/orchestration/runtime/ReplayRecorder.js';
import type { ExecutionSession } from '../core/orchestration/types.js';

async function runTest() {
  const recorder = new ReplayRecorder();
  const session: ExecutionSession = {
    sessionId: 'replay-sess',
    startedAt: Date.now(),
    taskId: 't-1',
    intents: [],
    audits: [],
    repairPlans: [],
    executions: [],
    verifications: [],
    status: 'completed',
  };

  const replay = recorder.replay({
    sessionId: session.sessionId,
    mode: 'forensic',
    session,
    journal: [{ entryId: 'e1', sessionId: session.sessionId, timestamp: Date.now(), kind: 'session_started', payload: {} }],
    events: [{ kind: 'SessionStarted', sessionId: session.sessionId, mode: 'forensic', timestamp: Date.now() }],
    traces: [],
  });

  assert.strictEqual(replay.readonly, true);
  assert.strictEqual(replay.sessionId, 'replay-sess');
  assert.strictEqual(replay.journal.length, 1);

  replay.session.status = 'failed';
  assert.strictEqual(session.status, 'completed', 'replay must not mutate live session');

  const artifact = recorder.toCiArtifact(replay);
  assert.strictEqual(artifact.schema, 'broccolidb.runtime.replay/v1');
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('replay-recorder.test failed:', error);
    process.exit(1);
  });
