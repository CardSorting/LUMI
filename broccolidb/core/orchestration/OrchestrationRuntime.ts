// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import { LifecycleStateError } from '../errors.js';
import type { OwnedComponent } from '../agent-context/LifecycleRegistry.js';
import { lifecycleHealth } from '../agent-context/service-health.js';
import type { ServiceHealth } from '../agent-context/service-health.js';
import type { CapabilityIntent } from '../agent-context/intent-types.js';
import type { SpiderReport } from '../policy/spider/report-types.js';
import { ApprovalPolicyEngine } from './ApprovalPolicyEngine.js';
import { ExecutionTrace } from './ExecutionTrace.js';
import { MutationPlanner } from './MutationPlanner.js';
import { RepairExecutor, type SpiderResyncPort } from './RepairExecutor.js';
import { RollbackCoordinator } from './RollbackCoordinator.js';
import { VerificationPipeline, type InvariantPort, type SpiderVerificationPort } from './VerificationPipeline.js';
import type {
  ApprovalPolicy,
  BeginSessionInput,
  ExecutePlanInput,
  ExecutePlanResult,
  ExecutionSession,
  MutationPlan,
  PlanPreview,
  PlanRepairsInput,
  RuntimeHealth,
  VerificationResult,
  VerifyExecutionInput,
} from './types.js';

export interface OrchestrationRuntimeDeps {
  workspaceRoot: string;
  spider: SpiderVerificationPort & SpiderResyncPort;
  invariants: InvariantPort;
}

export class OrchestrationRuntime implements OwnedComponent {
  private lifecycleState: 'new' | 'started' | 'stopped' = 'new';
  private readonly sessions = new Map<string, ExecutionSession>();
  private readonly trace = new ExecutionTrace();
  private readonly policyEngine = new ApprovalPolicyEngine();
  private readonly planner = new MutationPlanner(this.policyEngine);
  private rollbackCoordinator!: RollbackCoordinator;
  private repairExecutor!: RepairExecutor;
  private verificationPipeline!: VerificationPipeline;

  private failedSessions = 0;
  private rollbackCount = 0;
  private verificationFailures = 0;
  private pendingApprovals = 0;
  private executionLatencies: number[] = [];
  private verificationLatencies: number[] = [];

  constructor(private readonly deps: OrchestrationRuntimeDeps) {}

  async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    this.rollbackCoordinator = new RollbackCoordinator(this.deps.workspaceRoot, this.trace);
    this.repairExecutor = new RepairExecutor(this.deps.workspaceRoot, this.deps.spider, this.trace);
    this.verificationPipeline = new VerificationPipeline(
      this.deps.spider,
      this.deps.invariants,
      this.trace
    );
    this.lifecycleState = 'started';
  }

  async stop(): Promise<void> {
    if (this.lifecycleState === 'stopped') return;
    this.sessions.clear();
    this.trace.clear();
    this.rollbackCoordinator?.clear();
    this.lifecycleState = 'stopped';
  }

  async flush(): Promise<void> {
    this.assertStarted('flush');
  }

  async health(): Promise<ServiceHealth> {
    return lifecycleHealth('orchestration', this.lifecycleState, {
      metrics: this.buildRuntimeHealth() as unknown as Record<string, number | string | boolean | null>,
    });
  }

  getRuntimeHealth(): RuntimeHealth {
    return this.buildRuntimeHealth();
  }

  getTrace(sessionId?: string) {
    return this.trace.getEvents(sessionId);
  }

  getSession(sessionId: string): ExecutionSession | undefined {
    return this.sessions.get(sessionId);
  }

  beginSession(input: BeginSessionInput = {}): ExecutionSession {
    this.assertStarted('beginSession');
    const session: ExecutionSession = {
      sessionId: randomUUID(),
      startedAt: Date.now(),
      agentId: input.agentId,
      taskId: input.taskId,
      correlationId: input.correlationId,
      intents: [],
      audits: [],
      repairPlans: [],
      executions: [],
      verifications: [],
      status: 'running',
    };
    this.sessions.set(session.sessionId, session);
    this.trace.emit(session.sessionId, 'session_started', {
      taskId: input.taskId,
      agentId: input.agentId,
    });
    return session;
  }

  recordAudit(sessionId: string, audit: SpiderReport): void {
    const session = this.requireSession(sessionId);
    session.audits.push(audit);
    this.trace.emit(sessionId, 'audit_recorded', { reportId: audit.reportId }, {
      correlationId: session.correlationId,
    });
  }

  recordIntent(sessionId: string, intent: CapabilityIntent): void {
    const session = this.requireSession(sessionId);
    session.intents.push(intent);
  }

  planRepairs(input: PlanRepairsInput): MutationPlan {
    this.assertStarted('planRepairs');
    const session = this.requireSession(input.sessionId);
    const plan = this.planner.planFromAudit({
      audit: input.audit,
      sessionId: input.sessionId,
      correlationId: input.correlationId ?? session.correlationId,
      policy: input.policy,
    });
    session.repairPlans.push(plan);
    this.trace.emit(input.sessionId, 'plan_created', {
      planId: plan.planId,
      stepCount: plan.steps.length,
      risk: plan.estimatedRisk,
    });
    return plan;
  }

  preview(plan: MutationPlan, policy: ApprovalPolicy): PlanPreview {
    this.assertStarted('preview');
    const policyDecision = this.policyEngine.evaluate(plan, policy);
    const { narrative } = this.planner.preview(plan, policy);
    return { plan, policyDecision, narrative };
  }

  async execute(input: ExecutePlanInput): Promise<ExecutePlanResult> {
    this.assertStarted('execute');
    const session = this.requireSession(input.plan.sessionId);

    const decision = this.policyEngine.assertAllowed(input.plan, input.policy, input.approvedBy);
    this.trace.emit(session.sessionId, 'approval_granted', {
      planId: input.plan.planId,
      policy: input.policy,
      approvedBy: input.approvedBy,
      reasons: decision.reasons,
    });

    const snapshotIds = this.rollbackCoordinator.snapshotBefore(
      input.plan.affectedFiles,
      session.sessionId
    );
    input.plan.rollbackStrategy.snapshotIds = snapshotIds;

    let execution;
    try {
      execution = await this.repairExecutor.execute(input.plan, session.sessionId, snapshotIds);
      session.executions.push(execution);
      const latency = (execution.finishedAt ?? Date.now()) - execution.startedAt;
      this.executionLatencies.push(latency);
      if (this.executionLatencies.length > 100) this.executionLatencies.shift();
    } catch (error) {
      session.status = 'failed';
      session.failureReason = error instanceof Error ? error.message : String(error);
      this.failedSessions++;
      const rollback = this.rollbackCoordinator.restore(snapshotIds, session.sessionId);
      if (rollback.restored.length > 0) {
        this.rollbackCount++;
        session.status = 'rolled_back';
        this.trace.emit(session.sessionId, 'session_rolled_back', { rollback });
      } else {
        this.trace.emit(session.sessionId, 'session_failed', { error: session.failureReason });
      }
      throw error;
    }

    session.status = 'verifying';
    return { execution, session };
  }

  async verify(input: VerifyExecutionInput): Promise<VerificationResult> {
    this.assertStarted('verify');
    const session = this.requireSession(input.sessionId);
    const baseline = input.baselineReport ?? session.audits[session.audits.length - 1];

    const started = Date.now();
    const result = await this.verificationPipeline.verify({
      execution: input.execution,
      sessionId: input.sessionId,
      baselineReport: baseline,
    });
    const latency = Date.now() - started;
    this.verificationLatencies.push(latency);
    if (this.verificationLatencies.length > 100) this.verificationLatencies.shift();

    session.verifications.push(result);

    if (!result.passed) {
      this.verificationFailures++;
      session.status = 'failed';
      session.failureReason = 'Verification failed after mutation';
      const lastExecution = session.executions[session.executions.length - 1];
      if (lastExecution?.snapshotIds.length) {
        const rollback = this.rollbackCoordinator.restore(lastExecution.snapshotIds, session.sessionId);
        if (rollback.restored.length > 0) {
          this.rollbackCount++;
          session.status = 'rolled_back';
          lastExecution.status = 'rolled_back';
          this.trace.emit(session.sessionId, 'session_rolled_back', { reason: 'verification_failed', rollback });
        }
      }
    } else {
      session.status = 'completed';
      this.trace.emit(session.sessionId, 'session_completed', {
        executionId: input.execution.executionId,
        verificationId: result.verificationId,
      });
      const lastExecution = session.executions[session.executions.length - 1];
      if (lastExecution) {
        this.rollbackCoordinator.discard(lastExecution.snapshotIds);
      }
    }

    return result;
  }

  requestApproval(plan: MutationPlan, policy: ApprovalPolicy): { pending: true; planId: string } {
    this.assertStarted('requestApproval');
    const session = this.requireSession(plan.sessionId);
    session.status = 'awaiting_approval';
    this.pendingApprovals++;
    this.trace.emit(plan.sessionId, 'approval_denied', {
      planId: plan.planId,
      policy,
      reason: 'awaiting human approval',
    });
    return { pending: true, planId: plan.planId };
  }

  private buildRuntimeHealth(): RuntimeHealth {
    const active = [...this.sessions.values()].filter(
      (s) => s.status === 'running' || s.status === 'verifying' || s.status === 'awaiting_approval'
    ).length;
    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    return {
      activeSessions: active,
      failedSessions: this.failedSessions,
      rollbackCount: this.rollbackCount,
      verificationFailures: this.verificationFailures,
      averageExecutionLatencyMs: avg(this.executionLatencies),
      averageVerificationLatencyMs: avg(this.verificationLatencies),
      pendingApprovals: this.pendingApprovals,
    };
  }

  private requireSession(sessionId: string): ExecutionSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new LifecycleStateError(`Execution session not found: ${sessionId}`);
    }
    return session;
  }

  private assertStarted(operation: string): void {
    if (this.lifecycleState !== 'started') {
      throw new LifecycleStateError(`OrchestrationRuntime.${operation} called before start().`);
    }
  }
}
