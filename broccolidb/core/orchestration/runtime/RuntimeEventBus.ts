// [LAYER: CORE]
/**
 * Observational event bus — subscribers must not trigger side effects.
 */
import type { RuntimeEvent } from './types.js';

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export class RuntimeEventBus {
  private readonly events: RuntimeEvent[] = [];
  private readonly handlers = new Set<RuntimeEventHandler>();
  private readonly maxEvents: number;

  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  emit(event: RuntimeEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  subscribe(handler: RuntimeEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getEvents(sessionId?: string): RuntimeEvent[] {
    if (!sessionId) return [...this.events];
    return this.events.filter((e) => e.sessionId === sessionId);
  }

  getRecentCritical(limit = 10): RuntimeEvent[] {
    const critical: RuntimeEvent['kind'][] = [
      'ExecutionFailed',
      'VerificationFailed',
      'BudgetExceeded',
      'PolicyViolation',
      'RollbackCompleted',
    ];
    return this.events.filter((e) => critical.includes(e.kind)).slice(-limit);
  }

  clear(): void {
    this.events.length = 0;
    this.handlers.clear();
  }
}
