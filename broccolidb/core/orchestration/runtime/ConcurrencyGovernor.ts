// [LAYER: CORE]
import { LifecycleStateError } from '../../errors.js';

export class ConcurrencyGovernor {
  private activeExecutions = 0;
  private maxConcurrent = 1;

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(0, max);
  }

  get utilization(): number {
    if (this.maxConcurrent === 0) return 0;
    return this.activeExecutions / this.maxConcurrent;
  }

  get active(): number {
    return this.activeExecutions;
  }

  acquire(sessionId: string): void {
    if (this.maxConcurrent === 0) {
      throw new LifecycleStateError(
        `ConcurrencyGovernor: mutations forbidden (maxConcurrent=0) for session ${sessionId}`
      );
    }
    if (this.activeExecutions >= this.maxConcurrent) {
      throw new LifecycleStateError(
        `ConcurrencyGovernor: max concurrent executions (${this.maxConcurrent}) reached`
      );
    }
    this.activeExecutions++;
  }

  release(): void {
    if (this.activeExecutions > 0) {
      this.activeExecutions--;
    }
  }

  reset(): void {
    this.activeExecutions = 0;
  }
}
