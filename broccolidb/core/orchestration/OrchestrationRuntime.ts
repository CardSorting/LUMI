// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import { LifecycleStateError } from '../errors.js';
import type { OwnedComponent } from '../agent-context/LifecycleRegistry.js';
import { lifecycleHealth } from '../agent-context/service-health.js';
import type { ServiceHealth } from '../agent-context/service-health.js';
import type { CapabilityIntent } from '../agent-context/intent-types.js';
import type { SpiderReport } from '../policy/spider/report-types.js';
import { ExecutionTrace } from './ExecutionTrace.js';
import { MutationPlanner } from './MutationPlanner.js';
import { RepairExecutor, type SpiderResyncPort } from './RepairExecutor.js';
import { RollbackCoordinator } from './RollbackCoordinator.js';
import { VerificationPipeline, type InvariantPort, type SpiderVerificationPort } from './VerificationPipeline.js';
import { RuntimeStateGraph, RuntimeOperator } from './state/index.js';
import {
  RuntimeGraphStore,
  RuntimeStoryBuilder,
  type ReplayHydrationResult,
  type ReplayMode,
  type RuntimeMemoryHealth,
  type RuntimeSnapshot,
  type RuntimeStory,
} from './state/store/index.js';
import type {
  RuntimeExportOptions,
  RuntimeExportResult,
  RuntimeExplainResult,
  RuntimeNextAction,
  RuntimeSessionState,
  OpenLoop,
  RuntimeBlocker,
  TimelineEntry,
  CausalChain,
  DiffView,
} from './state/types.js';
import {
  ConcurrencyGovernor,
  ExecutionBudgetManager,
  ReplayRecorder,
  RuntimeBudgetExceededError,
  RuntimeEventBus,
  RuntimePolicyEngine,
  RuntimePolicyViolationError,
  RuntimeScheduler,
  SessionJournal,
  SessionQueue,
  DEFAULT_BUDGETS,
  MODE_CONFIGS,
  type RuntimeMode,
  type ReplayResult,
} from './runtime/index.js';
import type {
  ApprovalPolicy,
  BeginSessionInput,
  ExecutePlanInput,
  ExecutePlanResult,
  ExecutionSession,
  ExecutionSessionStatus,
  MutationPlan,
  PlanPreview,
  PlanRepairsInput,
  RuntimeHealth,
  VerificationResult,
  VerifyExecutionInput,
} from './types.js';
import type { BufferedDbPool } from '../../infrastructure/db/BufferedDbPool.js';
import type { StorageService } from '../../infrastructure/storage/StorageService.js';
import { RuntimeGraphSerializer } from './state/store/RuntimeGraphSerializer.js';

export interface OrchestrationRuntimeDeps {
  workspaceRoot: string;
  spider: SpiderVerificationPort & SpiderResyncPort;
  invariants: InvariantPort;
  db?: BufferedDbPool;
  storage?: StorageService;
  userId?: string;
}

export class OrchestrationRuntime implements OwnedComponent {
  private lifecycleState: 'new' | 'started' | 'stopped' = 'new';
  private readonly sessions = new Map<string, ExecutionSession>();
  private readonly sessionNodeIds = new Map<string, string>();
  private readonly stateGraph = new RuntimeStateGraph();
  private readonly operator = new RuntimeOperator(this.stateGraph);
  private readonly graphStore: RuntimeGraphStore;
  private readonly storyBuilder: RuntimeStoryBuilder;
  private readonly graphSerializer = new RuntimeGraphSerializer();
  private readonly trace = new ExecutionTrace();
  private readonly policyEngine = new RuntimePolicyEngine();
  private readonly planner = new MutationPlanner(this.policyEngine);
  private readonly eventBus = new RuntimeEventBus();
  private readonly journal = new SessionJournal();
  private readonly replayRecorder = new ReplayRecorder();
  private readonly budgetManager = new ExecutionBudgetManager();
  private readonly concurrency = new ConcurrencyGovernor();
  private readonly queue = new SessionQueue();
  private scheduler!: RuntimeScheduler;

  private rollbackCoordinator!: RollbackCoordinator;
  private repairExecutor!: RepairExecutor;
  private verificationPipeline!: VerificationPipeline;

  private runtimeMode: RuntimeMode = 'development';
  private failedSessions = 0;
  private rollbackCount = 0;
  private verificationFailures = 0;
  private pendingApprovals = 0;
  private budgetViolations = 0;
  private policyViolations = 0;
  private executionLatencies: number[] = [];
  private verificationLatencies: number[] = [];

  constructor(private readonly deps: OrchestrationRuntimeDeps) {
    this.graphStore = new RuntimeGraphStore({
      graph: this.stateGraph,
      db: deps.db,
      storage: deps.storage,
      userId: deps.userId,
    });
    this.storyBuilder = new RuntimeStoryBuilder(this.stateGraph, this.operator);
  }

  async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    this.rollbackCoordinator = new RollbackCoordinator(this.deps.workspaceRoot, this.trace);
    this.repairExecutor = new RepairExecutor(this.deps.workspaceRoot, this.deps.spider, this.trace);
    this.verificationPipeline = new VerificationPipeline(
      this.deps.spider,
      this.deps.invariants,
      this.trace
    );
    this.scheduler = new RuntimeScheduler(
      this.queue,
      this.concurrency,
      this.budgetManager,
      this.policyEngine,
      () => this.runtimeMode,
      (id) => this.sessions.get(id),
      (session) => this.resolveSessionBudget(session)
    );
    this.concurrency.setMaxConcurrent(MODE_CONFIGS[this.runtimeMode].maxConcurrentExecutions);
    await this.graphStore.start();
    await this.restorePersistedSessions();
    this.lifecycleState = 'started';
  }

  async stop(): Promise<void> {
    if (this.lifecycleState === 'stopped') return;
    await this.graphStore.stop();
    this.sessions.clear();
    this.sessionNodeIds.clear();
    this.stateGraph.clear();
    this.trace.clear();
    this.eventBus.clear();
    this.journal.clear();
    this.queue.clear();
    this.budgetManager.clear();
    this.concurrency.reset();
    this.rollbackCoordinator?.clear();
    this.lifecycleState = 'stopped';
  }

  async flush(): Promise<void> {
    this.assertStarted('flush');
    await this.graphStore.flush();
  }

  async health(): Promise<ServiceHealth> {
    const health = this.buildRuntimeHealth();
    return lifecycleHealth('orchestration', this.lifecycleState, {
      degraded: health.status === 'degraded',
      critical: health.status === 'critical',
      metrics: health as unknown as Record<string, number | string | boolean | null>,
    });
  }

  setMode(mode: RuntimeMode): void {
    this.assertStarted('setMode');
    this.runtimeMode = mode;
    this.concurrency.setMaxConcurrent(MODE_CONFIGS[mode].maxConcurrentExecutions);
  }

  getMode(): RuntimeMode {
    return this.runtimeMode;
  }

  getRuntimeHealth(): RuntimeHealth {
    return this.buildRuntimeHealth();
  }

  getTrace(sessionId?: string) {
    return this.trace.getEvents(sessionId);
  }

  getRuntimeEvents(sessionId?: string) {
    return this.eventBus.getEvents(sessionId);
  }

  getJournal(sessionId: string) {
    return this.journal.getEntries(sessionId);
  }

  getSession(sessionId: string): ExecutionSession | undefined {
    return this.sessions.get(sessionId);
  }

  // --- v28 Operator APIs (canonical views from RuntimeStateGraph) ---

  state(sessionId: string): RuntimeSessionState {
    this.assertStarted('state');
    return this.operator.state(sessionId, this.graphContext(sessionId));
  }

  timeline(sessionId: string): TimelineEntry[] {
    this.assertStarted('timeline');
    return this.operator.timeline(sessionId);
  }

  explain(sessionId: string): RuntimeExplainResult {
    this.assertStarted('explain');
    return this.operator.explain(sessionId, this.graphContext(sessionId));
  }

  nextActions(sessionId: string): RuntimeNextAction[] {
    this.assertStarted('nextActions');
    return this.operator.nextActions(sessionId, this.graphContext(sessionId));
  }

  export(sessionId: string, options: RuntimeExportOptions): RuntimeExportResult {
    this.assertStarted('export');
    return this.operator.export(sessionId, this.graphContext(sessionId), options);
  }

  openLoops(): OpenLoop[] {
    this.assertStarted('openLoops');
    return this.operator.openLoops({ sessions: [...this.sessions.values()] });
  }

  blockers(sessionId?: string): RuntimeBlocker[] {
    this.assertStarted('blockers');
    if (sessionId) {
      return this.operator.blockers(sessionId, this.graphContext(sessionId));
    }
    return [...this.sessions.keys()].flatMap((id) =>
      this.operator.blockers(id, this.graphContext(id))
    );
  }

  causalView(sessionId: string): CausalChain {
    this.assertStarted('causalView');
    return this.operator.causalView(sessionId);
  }

  diffView(sessionId: string): DiffView {
    this.assertStarted('diffView');
    return this.operator.diffView(sessionId, this.graphContext(sessionId));
  }

  async snapshot(sessionId: string): Promise<RuntimeSnapshot> {
    this.assertStarted('snapshot');
    this.graphStore.verifySession(sessionId, this.sessions.get(sessionId));
    const snap = await this.graphStore.snapshot(sessionId, this.runtimeMode);
    this.graphStore.markDirty(sessionId);
    return snap;
  }

  story(sessionId: string): RuntimeStory {
    this.assertStarted('story');
    return this.storyBuilder.build(sessionId, this.graphContext(sessionId));
  }

  getMemoryHealth(): RuntimeMemoryHealth {
    this.assertStarted('getMemoryHealth');
    const sessionIds =
      this.sessions.size > 0
        ? [...this.sessions.keys()]
        : [
            ...new Set(
              this.graphStore.snapshots
                .list()
                .map((s) => s.sessionId)
                .filter((id): id is string => Boolean(id))
            ),
          ];
    return this.graphStore.getMemoryHealth(sessionIds);
  }

  // --- Session lifecycle ---

  async beginSession(input: BeginSessionInput = {}): Promise<ExecutionSession> {
    this.assertStarted('beginSession');
    const session: ExecutionSession = {
      sessionId: randomUUID(),
      startedAt: Date.now(),
      agentId: input.agentId,
      taskId: input.taskId,
      correlationId: input.correlationId,
      priority: input.priority,
      budget: input.budget,
      runtimeMode: this.runtimeMode,
      intents: [],
      audits: [],
      repairPlans: [],
      executions: [],
      verifications: [],
      status: 'running',
    };
    this.sessions.set(session.sessionId, session);

    const sessionNodeId = this.stateGraph.recordSession(session);
    this.sessionNodeIds.set(session.sessionId, sessionNodeId);
    this.stateGraph.recordHealthSnapshot(session.sessionId, this.buildRuntimeHealth() as unknown as Record<string, unknown>);

    const event = {
      kind: 'SessionStarted' as const,
      sessionId: session.sessionId,
      taskId: input.taskId,
      mode: this.runtimeMode,
      timestamp: Date.now(),
    };
    this.trace.emit(session.sessionId, 'session_started', { taskId: input.taskId, agentId: input.agentId, mode: this.runtimeMode });
    this.journal.record(session.sessionId, 'session_started', { taskId: input.taskId, mode: this.runtimeMode, budget: input.budget });
    this.eventBus.emit(event);
    this.stateGraph.recordRuntimeEvent(session.sessionId, sessionNodeId, event);
    this.indexSession(session);
    return session;
  }

  recordAudit(sessionId: string, audit: SpiderReport): void {
    const session = this.requireSession(sessionId);
    const sessionNodeId = this.requireSessionNode(sessionId);
    session.audits.push(audit);

    this.stateGraph.recordAudit(sessionId, sessionNodeId, audit);
    this.trace.emit(sessionId, 'audit_recorded', { reportId: audit.reportId }, { correlationId: session.correlationId });
    this.journal.record(sessionId, 'audit', { reportId: audit.reportId });

    const event = { kind: 'AuditCompleted' as const, sessionId, reportId: audit.reportId, timestamp: Date.now() };
    this.eventBus.emit(event);
    this.stateGraph.recordRuntimeEvent(sessionId, sessionNodeId, event);
    this.graphStore.markDirty(sessionId);
    this.indexSession(session);
  }

  recordGate(sessionId: string, exitCode: number, auditReportId?: string): void {
    const sessionNodeId = this.requireSessionNode(sessionId);
    const reportId = auditReportId ?? this.sessions.get(sessionId)?.audits.at(-1)?.reportId;
    this.stateGraph.recordGate(sessionId, sessionNodeId, exitCode, reportId);
    this.journal.record(sessionId, 'gate', { exitCode });

    if (exitCode !== 0) {
      const event = { kind: 'GateBlocked' as const, sessionId, exitCode, timestamp: Date.now() };
      this.eventBus.emit(event);
      this.stateGraph.recordRuntimeEvent(sessionId, sessionNodeId, event);
      this.stateGraph.updateSessionStatus(sessionId, 'blocked');
      const session = this.sessions.get(sessionId);
      if (session) session.status = 'blocked';
    }
  }

  recordIntent(sessionId: string, intent: CapabilityIntent): void {
    const session = this.requireSession(sessionId);
    const sessionNodeId = this.requireSessionNode(sessionId);
    session.intents.push(intent);
    this.stateGraph.recordIntent(sessionId, sessionNodeId, intent);
  }

  planRepairs(input: PlanRepairsInput): MutationPlan {
    this.assertStarted('planRepairs');
    const session = this.requireSession(input.sessionId);
    const sessionNodeId = this.requireSessionNode(input.sessionId);
    const policy = input.policy ?? this.policyEngine.defaultPolicyForMode(this.runtimeMode);

    if (!input.audit?.reportId) {
      throw new LifecycleStateError('planRepairs requires audit with reportId linked to session');
    }

    const plan = this.planner.planFromAudit({
      audit: input.audit,
      sessionId: input.sessionId,
      correlationId: input.correlationId ?? session.correlationId,
      policy,
    });
    session.repairPlans.push(plan);

    this.stateGraph.recordPlan(input.sessionId, sessionNodeId, plan, input.audit.reportId);
    this.trace.emit(input.sessionId, 'plan_created', { planId: plan.planId, stepCount: plan.steps.length, risk: plan.estimatedRisk });
    this.journal.record(input.sessionId, 'plan', { planId: plan.planId, stepCount: plan.steps.length, risk: plan.estimatedRisk });

    const event = {
      kind: 'PlanGenerated' as const,
      sessionId: input.sessionId,
      planId: plan.planId,
      stepCount: plan.steps.length,
      timestamp: Date.now(),
    };
    this.eventBus.emit(event);
    this.stateGraph.recordRuntimeEvent(input.sessionId, sessionNodeId, event);
    this.graphStore.markDirty(input.sessionId);
    this.indexSession(session);
    return plan;
  }

  preview(plan: MutationPlan, policy?: ApprovalPolicy): PlanPreview {
    this.assertStarted('preview');
    const resolvedPolicy = policy ?? this.policyEngine.defaultPolicyForMode(this.runtimeMode);
    const policyDecision = this.policyEngine.evaluate(plan, resolvedPolicy);
    const { narrative } = this.planner.preview(plan, resolvedPolicy);
    return { plan, policyDecision, narrative };
  }

  async execute(input: ExecutePlanInput): Promise<ExecutePlanResult> {
    this.assertStarted('execute');
    const sessionId = input.sessionId ?? input.plan.sessionId;
    const session = this.requireSession(sessionId);
    const policy = input.policy ?? this.policyEngine.defaultPolicyForMode(this.runtimeMode);

    if (!this.policyEngine.isMutationAllowed(this.runtimeMode)) {
      this.policyViolations++;
      const reasons = [`runtime mode '${this.runtimeMode}' forbids mutation`];
      const violationId = this.stateGraph.recordPolicyViolation(sessionId, reasons);
      this.stateGraph.link(violationId, this.requireSessionNode(sessionId), 'blocked_by');
      this.emitPolicyViolation(sessionId, reasons);
      throw new RuntimePolicyViolationError(reasons.join('; '), reasons);
    }

    try {
      this.scheduler.schedule({
        plan: input.plan,
        policy,
        approvedBy: input.approvedBy,
        priority: input.priority,
      });
    } catch (error) {
      if (error instanceof RuntimeBudgetExceededError) {
        this.budgetViolations++;
        const violationId = this.stateGraph.recordBudgetViolation(sessionId, error.reason);
        this.stateGraph.link(violationId, this.requireSessionNode(sessionId), 'failed_due_to');
        this.journal.record(sessionId, 'budget_exceeded', { reason: error.reason });
        this.eventBus.emit({ kind: 'BudgetExceeded', sessionId, reason: error.reason, timestamp: Date.now() });
        await this.handleBudgetExceeded(session, input.plan);
      } else if (error instanceof RuntimePolicyViolationError) {
        this.policyViolations++;
        const violationId = this.stateGraph.recordPolicyViolation(sessionId, error.reasons);
        this.stateGraph.link(violationId, this.requireSessionNode(sessionId), 'blocked_by');
        this.journal.record(sessionId, 'policy_violation', { reasons: error.reasons });
        this.emitPolicyViolation(sessionId, error.reasons);
      }
      throw error;
    }

    const result = await this.scheduler.dispatch(async (scheduledJob) =>
      this.executeJob(scheduledJob, session, policy)
    );

    if (!result) {
      throw new LifecycleStateError('Scheduler failed to dispatch execution job');
    }
    return result;
  }

  private async executeJob(
    job: import('./runtime/types.js').ScheduledJob,
    session: ExecutionSession,
    policy: ApprovalPolicy
  ): Promise<ExecutePlanResult> {
    const plan = job.plan;
    const sessionNodeId = this.requireSessionNode(session.sessionId);

    const decision = this.policyEngine.assertAllowed(plan, policy, job.approvedBy);
    const approvalId = this.stateGraph.recordApproval(session.sessionId, plan.planId, decision, job.approvedBy);
    this.stateGraph.linkSession(approvalId, sessionNodeId);

    this.trace.emit(session.sessionId, 'approval_granted', { planId: plan.planId, policy, approvedBy: job.approvedBy, reasons: decision.reasons });
    this.journal.record(session.sessionId, 'approval', { planId: plan.planId, policy });

    const snapshotIds = this.rollbackCoordinator.snapshotBefore(plan.affectedFiles, session.sessionId);
    plan.rollbackStrategy.snapshotIds = snapshotIds;

    const startEvent = {
      kind: 'ExecutionStarted' as const,
      sessionId: session.sessionId,
      executionId: 'pending',
      planId: plan.planId,
      timestamp: Date.now(),
    };
    this.eventBus.emit(startEvent);
    this.stateGraph.recordRuntimeEvent(session.sessionId, sessionNodeId, startEvent);

    let execution;
    let executionNodeId: string | undefined;
    try {
      execution = await this.repairExecutor.execute(plan, session.sessionId, snapshotIds);
      session.executions.push(execution);
      executionNodeId = this.stateGraph.recordExecution(session.sessionId, sessionNodeId, execution);

      this.budgetManager.recordFilesTouched(session.sessionId, plan.affectedFiles.length);
      const latency = (execution.finishedAt ?? Date.now()) - execution.startedAt;
      this.executionLatencies.push(latency);
      if (this.executionLatencies.length > 100) this.executionLatencies.shift();

      this.journal.record(session.sessionId, 'execution', { executionId: execution.executionId, status: execution.status });
      const successEvent = {
        kind: 'ExecutionSucceeded' as const,
        sessionId: session.sessionId,
        executionId: execution.executionId,
        timestamp: Date.now(),
      };
      this.eventBus.emit(successEvent);
      this.stateGraph.recordRuntimeEvent(session.sessionId, sessionNodeId, successEvent);
    } catch (error) {
      session.status = 'failed';
      session.failureReason = error instanceof Error ? error.message : String(error);
      this.failedSessions++;
      this.journal.record(session.sessionId, 'failure', { error: session.failureReason });
      const failEvent = {
        kind: 'ExecutionFailed' as const,
        sessionId: session.sessionId,
        error: session.failureReason,
        timestamp: Date.now(),
      };
      this.eventBus.emit(failEvent);
      this.stateGraph.recordRuntimeEvent(session.sessionId, sessionNodeId, failEvent);
      if (executionNodeId) {
        this.stateGraph.recordFailure(session.sessionId, executionNodeId, 'execution_failed', session.failureReason);
      }
      await this.performRollback(session, snapshotIds, 'execution_failed', executionNodeId);
      throw error;
    }

    session.status = 'verifying';
    this.stateGraph.updateSessionStatus(session.sessionId, 'verifying');
    return { execution, session };
  }

  async verify(input: VerifyExecutionInput): Promise<VerificationResult> {
    this.assertStarted('verify');
    const session = this.requireSession(input.sessionId);
    const sessionNodeId = this.requireSessionNode(input.sessionId);
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
    const verificationNodeId = this.stateGraph.recordVerification(input.sessionId, input.execution.executionId, result);
    this.stateGraph.linkSession(verificationNodeId, sessionNodeId);

    this.journal.record(input.sessionId, 'verification', { verificationId: result.verificationId, passed: result.passed });

    const openBlockers = this.operator.blockers(input.sessionId, this.graphContext(input.sessionId));
    const canComplete = result.passed && openBlockers.length === 0 && result.gateStatus === 'pass';

    if (!canComplete) {
      this.verificationFailures++;
      if (!result.passed) {
        this.budgetManager.recordVerificationFailure(input.sessionId);
      }
      session.status = result.passed && openBlockers.length > 0 ? 'blocked' : 'failed';
      session.failureReason =
        openBlockers.length > 0
          ? 'Open blockers remain after verification'
          : 'Verification failed after mutation';

      this.eventBus.emit({
        kind: 'VerificationFailed',
        sessionId: input.sessionId,
        verificationId: result.verificationId,
        timestamp: Date.now(),
      });
      this.stateGraph.recordFailure(
        input.sessionId,
        verificationNodeId,
        openBlockers.length > 0 ? 'open_blockers' : 'verification_failed',
        session.failureReason
      );

      const lastExecution = session.executions[session.executions.length - 1];
      if (lastExecution?.snapshotIds.length) {
        const execNodeId = `execution:${lastExecution.executionId}`;
        await this.performRollback(session, lastExecution.snapshotIds, 'verification_failed', execNodeId);
      }
    } else {
      session.status = 'completed';
      this.stateGraph.updateSessionStatus(session.sessionId, 'completed', { success: true });
      this.trace.emit(session.sessionId, 'session_completed', {
        executionId: input.execution.executionId,
        verificationId: result.verificationId,
      });
      this.journal.record(input.sessionId, 'completion', { verificationId: result.verificationId });
      this.eventBus.emit({
        kind: 'VerificationSucceeded',
        sessionId: input.sessionId,
        verificationId: result.verificationId,
        timestamp: Date.now(),
      });
      const lastExecution = session.executions[session.executions.length - 1];
      if (lastExecution) {
        this.rollbackCoordinator.discard(lastExecution.snapshotIds);
      }
    }

    this.stateGraph.recordHealthSnapshot(input.sessionId, this.buildRuntimeHealth() as unknown as Record<string, unknown>);
    this.graphStore.verifySession(input.sessionId, session);
    this.graphStore.markDirty(input.sessionId);
    this.indexSession(session);
    return result;
  }

  async replay(
    sessionId: string,
    options: { mode?: ReplayMode; snapshotId?: string } = {}
  ): Promise<ReplayResult | ReplayHydrationResult | (ReplayResult & { hydration: ReplayHydrationResult; readonly: true })> {
    this.assertStarted('replay');
    const session = this.requireSession(sessionId);
    const sessionNodeId = this.requireSessionNode(sessionId);
    this.stateGraph.recordReplay(sessionId, sessionNodeId);

    const liveSnap = this.stateGraph.snapshot(sessionId);
    const serialized = this.graphSerializer.serialize(sessionId, liveSnap.nodes, liveSnap.edges);

    const hydration = await this.graphStore.replayHydrator.hydrate(this.stateGraph, sessionId, {
      mode: options.mode ?? 'forensic',
      snapshotId: options.snapshotId,
      liveGraphHash: serialized.graphHash,
    });

    if (options.mode && options.mode !== 'forensic') {
      return {
        ...hydration,
        projection: this.graphStore.replayHydrator.projectForMode(hydration),
      } as ReplayHydrationResult & { projection: Record<string, unknown> };
    }

    const legacy = this.replayRecorder.replay({
      sessionId,
      mode: session.runtimeMode ?? this.runtimeMode,
      session,
      journal: this.journal.getEntries(sessionId),
      events: this.eventBus.getEvents(sessionId),
      traces: this.trace.getEvents(sessionId),
    });

    return { ...legacy, hydration, readonly: true as const };
  }

  requestApproval(plan: MutationPlan, policy?: ApprovalPolicy): { pending: true; planId: string } {
    this.assertStarted('requestApproval');
    const resolvedPolicy = policy ?? this.policyEngine.defaultPolicyForMode(this.runtimeMode);
    const session = this.requireSession(plan.sessionId);
    session.status = 'awaiting_approval';
    this.stateGraph.updateSessionStatus(plan.sessionId, 'awaiting_approval');
    this.pendingApprovals++;
    this.trace.emit(plan.sessionId, 'approval_denied', { planId: plan.planId, policy: resolvedPolicy, reason: 'awaiting human approval' });
    return { pending: true, planId: plan.planId };
  }

  private indexSession(session: ExecutionSession): void {
    this.graphStore.index.indexSession(session, this.stateGraph);
  }

  private async restorePersistedSessions(): Promise<void> {
    const bySession = new Map<string, RuntimeSnapshot>();
    for (const snap of this.graphStore.snapshots.list()) {
      if (!snap.sessionId) continue;
      const prev = bySession.get(snap.sessionId);
      if (!prev || snap.createdAt > prev.createdAt) {
        bySession.set(snap.sessionId, snap);
      }
    }

    for (const [sessionId, snap] of bySession) {
      if (this.sessions.has(sessionId)) continue;
      try {
        const { graph } = await this.graphStore.snapshots.load(snap.snapshotId);
        this.stateGraph.hydrate(sessionId, graph.nodes, graph.edges);
        const sessionNode = graph.nodes.find((n) => n.kind === 'Session');
        const sessionNodeId = sessionNode?.id ?? `session:${sessionId}`;
        this.sessionNodeIds.set(sessionId, sessionNodeId);

        const nodeData = sessionNode?.data as Record<string, unknown> | undefined;
        const restored: ExecutionSession = {
          sessionId,
          startedAt: sessionNode?.timestamp ?? snap.createdAt,
          taskId: nodeData?.taskId as string | undefined,
          agentId: nodeData?.agentId as string | undefined,
          runtimeMode: snap.mode,
          intents: [],
          audits: [],
          repairPlans: [],
          executions: [],
          verifications: [],
          status: (nodeData?.status as ExecutionSessionStatus) ?? 'running',
        };
        this.sessions.set(sessionId, restored);
        this.indexSession(restored);
      } catch {
        // skip corrupt snapshots during recovery
      }
    }
  }

  private graphContext(sessionId: string) {
    return {
      session: this.requireSession(sessionId),
      health: this.buildRuntimeHealth(),
      runtimeMode: this.runtimeMode,
      events: this.eventBus.getEvents(sessionId),
    };
  }

  private emitPolicyViolation(sessionId: string, reasons: string[]): void {
    this.eventBus.emit({ kind: 'PolicyViolation', sessionId, reasons, timestamp: Date.now() });
    const sessionNodeId = this.sessionNodeIds.get(sessionId);
    if (sessionNodeId) {
      this.stateGraph.recordRuntimeEvent(sessionId, sessionNodeId, {
        kind: 'PolicyViolation',
        sessionId,
        reasons,
        timestamp: Date.now(),
      });
    }
  }

  private async handleBudgetExceeded(session: ExecutionSession, plan: MutationPlan): Promise<void> {
    session.status = 'failed';
    session.failureReason = 'Execution budget exceeded';
    this.failedSessions++;
    this.stateGraph.updateSessionStatus(session.sessionId, 'failed', { failureReason: session.failureReason });
    if (plan.rollbackStrategy.snapshotIds.length > 0) {
      await this.performRollback(session, plan.rollbackStrategy.snapshotIds, 'budget_exceeded');
    }
  }

  private async performRollback(
    session: ExecutionSession,
    snapshotIds: string[],
    reason: string,
    sourceNodeId?: string
  ): Promise<void> {
    this.budgetManager.recordRollbackAttempt(session.sessionId);
    this.eventBus.emit({
      kind: 'RollbackStarted',
      sessionId: session.sessionId,
      snapshotCount: snapshotIds.length,
      timestamp: Date.now(),
    });

    const rollback = this.rollbackCoordinator.restore(snapshotIds, session.sessionId);
    const source = sourceNodeId ?? this.requireSessionNode(session.sessionId);
    const rollbackId = this.stateGraph.recordRollback(session.sessionId, source, reason, rollback.restored);

    if (rollback.restored.length > 0) {
      this.rollbackCount++;
      session.status = 'rolled_back';
      this.stateGraph.updateSessionStatus(session.sessionId, 'rolled_back');
      this.journal.record(session.sessionId, 'rollback', { reason, restored: rollback.restored, rollbackId });
      this.trace.emit(session.sessionId, 'session_rolled_back', { reason, rollback });
      this.eventBus.emit({
        kind: 'RollbackCompleted',
        sessionId: session.sessionId,
        restored: rollback.restored,
        timestamp: Date.now(),
      });
    } else if (rollback.failed.length > 0) {
      session.failureReason = 'Rollback failed';
      this.stateGraph.recordFailure(session.sessionId, rollbackId, 'rollback_failed', session.failureReason);
    }
  }

  private resolveSessionBudget(session: ExecutionSession) {
    const modeBudget = DEFAULT_BUDGETS[session.runtimeMode ?? this.runtimeMode];
    return this.budgetManager.resolveBudget(session, modeBudget);
  }

  private buildRuntimeHealth(): RuntimeHealth {
    const active = [...this.sessions.values()].filter(
      (s) => s.status === 'running' || s.status === 'verifying' || s.status === 'awaiting_approval'
    ).length;
    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    const recentCritical = this.eventBus.getRecentCritical(10);
    let status: RuntimeHealth['status'] = 'healthy';
    if (this.policyViolations > 0 || this.budgetViolations > 0) {
      status = 'degraded';
    }
    if (this.failedSessions > 5 || recentCritical.length >= 5) {
      status = 'critical';
    }

    return {
      status,
      activeSessions: active,
      queuedSessions: this.queue.length,
      failedSessions: this.failedSessions,
      rollbackCount: this.rollbackCount,
      verificationFailures: this.verificationFailures,
      averageExecutionLatencyMs: avg(this.executionLatencies),
      averageVerificationLatencyMs: avg(this.verificationLatencies),
      pendingApprovals: this.pendingApprovals,
      concurrencyUtilization: this.concurrency.utilization,
      budgetViolations: this.budgetViolations,
      policyViolations: this.policyViolations,
      runtimeMode: this.runtimeMode,
      recentCriticalEvents: recentCritical,
    };
  }

  private requireSession(sessionId: string): ExecutionSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new LifecycleStateError(`Execution session not found: ${sessionId}`);
    }
    return session;
  }

  private requireSessionNode(sessionId: string): string {
    const nodeId = this.sessionNodeIds.get(sessionId);
    if (!nodeId) {
      throw new LifecycleStateError(`Session graph node not found: ${sessionId}`);
    }
    return nodeId;
  }

  private assertStarted(operation: string): void {
    if (this.lifecycleState !== 'started') {
      throw new LifecycleStateError(`OrchestrationRuntime.${operation} called before start().`);
    }
  }
}
