// [LAYER: CORE]
import { AgentGitError } from '../../errors.js';
import type { ExecutionSession, MutationPlan } from '../types.js';
import type { BudgetCheckInput, ExecutionBudget } from './types.js';

export class RuntimeBudgetExceededError extends AgentGitError {
  constructor(
    message: string,
    public readonly sessionId: string,
    public readonly reason: string
  ) {
    super(message, 'BUDGET_EXCEEDED');
    this.name = 'RuntimeBudgetExceededError';
  }
}

export class ExecutionBudgetManager {
  private readonly sessionCounters = new Map<
    string,
    { verificationFailures: number; rollbackAttempts: number; filesTouched: number }
  >();

  resolveBudget(session: ExecutionSession, modeBudget: ExecutionBudget): ExecutionBudget {
    return { ...modeBudget, ...session.budget };
  }

  assertWithinBudget(input: BudgetCheckInput): void {
    const { session, budget, plan } = input;
    const counters = this.getCounters(session.sessionId);
    const elapsed = Date.now() - session.startedAt;

    if (elapsed > budget.maxDurationMs) {
      throw new RuntimeBudgetExceededError(
        `Session ${session.sessionId} exceeded maxDurationMs (${budget.maxDurationMs})`,
        session.sessionId,
        'maxDurationMs'
      );
    }

    const filesToTouch = plan.affectedFiles.length;
    if (counters.filesTouched + filesToTouch > budget.maxFilesTouched) {
      throw new RuntimeBudgetExceededError(
        `Session ${session.sessionId} would exceed maxFilesTouched (${budget.maxFilesTouched})`,
        session.sessionId,
        'maxFilesTouched'
      );
    }

    if (plan.steps.length > budget.maxDirectives) {
      throw new RuntimeBudgetExceededError(
        `Plan exceeds maxDirectives (${budget.maxDirectives})`,
        session.sessionId,
        'maxDirectives'
      );
    }

    if (counters.verificationFailures > budget.maxVerificationFailures) {
      throw new RuntimeBudgetExceededError(
        `Session exceeded maxVerificationFailures (${budget.maxVerificationFailures})`,
        session.sessionId,
        'maxVerificationFailures'
      );
    }

    if (counters.rollbackAttempts > budget.maxRollbackAttempts) {
      throw new RuntimeBudgetExceededError(
        `Session exceeded maxRollbackAttempts (${budget.maxRollbackAttempts})`,
        session.sessionId,
        'maxRollbackAttempts'
      );
    }
  }

  recordFilesTouched(sessionId: string, count: number): void {
    const counters = this.getCounters(sessionId);
    counters.filesTouched += count;
  }

  recordVerificationFailure(sessionId: string): void {
    this.getCounters(sessionId).verificationFailures++;
  }

  recordRollbackAttempt(sessionId: string): void {
    this.getCounters(sessionId).rollbackAttempts++;
  }

  getCounters(sessionId: string) {
    let counters = this.sessionCounters.get(sessionId);
    if (!counters) {
      counters = { verificationFailures: 0, rollbackAttempts: 0, filesTouched: 0 };
      this.sessionCounters.set(sessionId, counters);
    }
    return counters;
  }

  clearSession(sessionId: string): void {
    this.sessionCounters.delete(sessionId);
  }

  clear(): void {
    this.sessionCounters.clear();
  }
}
