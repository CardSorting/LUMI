// [LAYER: CORE]
import type { ExecutionSession } from '../types.js';
import type { ExecutionTraceEvent } from '../types.js';
import type { ReplayResult, RuntimeEvent, RuntimeMode, SessionJournalEntry } from './types.js';

export class ReplayRecorder {
  replay(input: {
    sessionId: string;
    mode: RuntimeMode;
    session: ExecutionSession;
    journal: SessionJournalEntry[];
    events: RuntimeEvent[];
    traces: ExecutionTraceEvent[];
  }): ReplayResult {
    return {
      sessionId: input.sessionId,
      mode: input.mode,
      readonly: true,
      session: structuredClone(input.session),
      journal: [...input.journal],
      events: [...input.events],
      traces: input.traces.map((t) => ({
        kind: t.kind,
        timestamp: t.timestamp,
        detail: { ...t.detail },
      })),
    };
  }

  toCiArtifact(replay: ReplayResult): Record<string, unknown> {
    return {
      schema: 'broccolidb.runtime.replay/v1',
      sessionId: replay.sessionId,
      mode: replay.mode,
      status: replay.session.status,
      auditCount: replay.session.audits.length,
      planCount: replay.session.repairPlans.length,
      executionCount: replay.session.executions.length,
      verificationCount: replay.session.verifications.length,
      journalEntries: replay.journal.length,
      eventCount: replay.events.length,
      failureReason: replay.session.failureReason ?? null,
    };
  }
}
