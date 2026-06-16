// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type { ExecutionTraceEvent, ExecutionTraceEventKind } from './types.js';

export class ExecutionTrace {
  private readonly events: ExecutionTraceEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 500) {
    this.maxEvents = maxEvents;
  }

  emit(
    sessionId: string,
    kind: ExecutionTraceEventKind,
    detail: Record<string, unknown> = {},
    options: { correlationId?: string; intentId?: string } = {}
  ): ExecutionTraceEvent {
    const event: ExecutionTraceEvent = {
      eventId: randomUUID(),
      sessionId,
      correlationId: options.correlationId,
      intentId: options.intentId,
      kind,
      timestamp: Date.now(),
      detail,
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    return event;
  }

  getEvents(sessionId?: string): ExecutionTraceEvent[] {
    if (!sessionId) return [...this.events];
    return this.events.filter((e) => e.sessionId === sessionId);
  }

  clear(): void {
    this.events.length = 0;
  }
}
