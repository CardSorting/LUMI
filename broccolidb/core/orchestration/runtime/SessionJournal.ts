// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type { SessionJournalEntry, SessionJournalKind } from './types.js';

export class SessionJournal {
  private readonly entries: SessionJournalEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  record(sessionId: string, kind: SessionJournalKind, payload: Record<string, unknown> = {}): SessionJournalEntry {
    const entry: SessionJournalEntry = {
      entryId: randomUUID(),
      sessionId,
      timestamp: Date.now(),
      kind,
      payload,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    return entry;
  }

  getEntries(sessionId: string): SessionJournalEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  getAll(): SessionJournalEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}
