// [LAYER: CORE]
/**
 * Deterministic FIFO scheduler with priority ordering and concurrency caps.
 * All mutations route through this scheduler — no bypass permitted.
 */
import type { ExecutePlanResult } from '../types.js';
import type { ConcurrencyGovernor } from './ConcurrencyGovernor.js';
import type { ExecutionBudgetManager } from './ExecutionBudgetManager.js';
import type { RuntimePolicyEngine } from './RuntimePolicyEngine.js';
import type { SessionQueue } from './SessionQueue.js';
import type { RuntimeMode, ScheduledJob } from './types.js';
import type { ExecutionSession, MutationPlan, ApprovalPolicy } from '../types.js';
import type { IntentPriority } from '../../agent-context/intent-types.js';

export type ExecuteFn = (job: ScheduledJob) => Promise<ExecutePlanResult>;

export class RuntimeScheduler {
  private processing = false;

  constructor(
    private readonly queue: SessionQueue,
    private readonly concurrency: ConcurrencyGovernor,
    private readonly budgetManager: ExecutionBudgetManager,
    private readonly policyEngine: RuntimePolicyEngine,
    private readonly getMode: () => RuntimeMode,
    private readonly getSession: (id: string) => ExecutionSession | undefined,
    private readonly resolveBudget: (session: ExecutionSession) => import('./types.js').ExecutionBudget
  ) {}

  schedule(input: {
    plan: MutationPlan;
    policy: ApprovalPolicy;
    approvedBy?: string;
    priority?: IntentPriority;
  }): ScheduledJob {
    const session = this.getSession(input.plan.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${input.plan.sessionId}`);
    }

    const budget = this.resolveBudget(session);
    this.budgetManager.assertWithinBudget({ session, budget, plan: input.plan });
    this.policyEngine.assertExecutionAllowed({
      mode: this.getMode(),
      plan: input.plan,
      session,
      budget,
      policy: input.policy,
      approvedBy: input.approvedBy,
    });

    return this.queue.enqueue({
      sessionId: input.plan.sessionId,
      priority: input.priority ?? session.priority ?? 'normal',
      kind: 'execute',
      plan: input.plan,
      policy: input.policy,
      approvedBy: input.approvedBy,
    });
  }

  async dispatch(executeFn: ExecuteFn): Promise<ExecutePlanResult | null> {
    if (this.processing) {
      return null;
    }

    const job = this.queue.dequeue();
    if (!job) return null;

    this.processing = true;
    try {
      this.concurrency.acquire(job.sessionId);
      const result = await executeFn(job);
      return result;
    } finally {
      this.concurrency.release();
      this.processing = false;
    }
  }

  async processAll(executeFn: ExecuteFn): Promise<ExecutePlanResult[]> {
    const results: ExecutePlanResult[] = [];
    let result: ExecutePlanResult | null;
    while ((result = await this.dispatch(executeFn))) {
      results.push(result);
    }
    return results;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}
