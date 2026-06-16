// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type { IntentPriority } from '../../agent-context/intent-types.js';
import type { ScheduledJob } from './types.js';

const PRIORITY_ORDER: Record<IntentPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export class SessionQueue {
  private readonly queue: ScheduledJob[] = [];

  enqueue(job: Omit<ScheduledJob, 'jobId' | 'enqueuedAt'>): ScheduledJob {
    const entry: ScheduledJob = {
      ...job,
      jobId: randomUUID(),
      enqueuedAt: Date.now(),
    };
    this.queue.push(entry);
    this.queue.sort((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pd !== 0) return pd;
      return a.enqueuedAt - b.enqueuedAt;
    });
    return entry;
  }

  dequeue(): ScheduledJob | undefined {
    return this.queue.shift();
  }

  peek(): ScheduledJob | undefined {
    return this.queue[0];
  }

  get length(): number {
    return this.queue.length;
  }

  getQueuedSessionIds(): string[] {
    return [...new Set(this.queue.map((j) => j.sessionId))];
  }

  clear(): void {
    this.queue.length = 0;
  }
}
