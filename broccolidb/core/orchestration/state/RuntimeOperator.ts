// [LAYER: CORE]
import type { ExecutionSession } from '../types.js';
import type { RuntimeStateGraph } from './RuntimeStateGraph.js';
import type {
  CausalChain,
  DiffView,
  FailureCause,
  GraphNode,
  OpenLoop,
  RuntimeBlocker,
  RuntimeExplainResult,
  RuntimeExportOptions,
  RuntimeExportResult,
  RuntimeNextAction,
  RuntimeSessionState,
  StateGraphContext,
  TimelineEntry,
} from './types.js';
import type { ApprovalPolicy } from '../types.js';
import type { SpiderFinding } from '../../policy/spider/report-types.js';

export class RuntimeOperator {
  constructor(private readonly graph: RuntimeStateGraph) {}

  state(sessionId: string, ctx: StateGraphContext): RuntimeSessionState {
    const graph = this.graph.snapshot(sessionId);
    const blockers = this.blockers(sessionId, ctx);
    const failureCause = this.resolveFailureCause(sessionId, ctx, blockers);
    const success = this.isSuccess(sessionId, ctx, blockers);

    return {
      sessionId,
      status: ctx.session.status,
      runtimeMode: ctx.session.runtimeMode ?? ctx.runtimeMode,
      taskId: ctx.session.taskId,
      agentId: ctx.session.agentId,
      startedAt: ctx.session.startedAt,
      failureCause,
      failureReason: ctx.session.failureReason,
      success,
      graph,
      summary: {
        intentCount: graph.nodes.filter((n) => n.kind === 'Intent').length,
        auditCount: graph.nodes.filter((n) => n.kind === 'Audit').length,
        findingCount: graph.nodes.filter((n) => n.kind === 'Finding').length,
        planCount: graph.nodes.filter((n) => n.kind === 'MutationPlan').length,
        executionCount: graph.nodes.filter((n) => n.kind === 'Execution').length,
        verificationCount: graph.nodes.filter((n) => n.kind === 'Verification').length,
        rollbackCount: graph.nodes.filter((n) => n.kind === 'Rollback').length,
        openBlockerCount: blockers.length,
      },
    };
  }

  timeline(sessionId: string): TimelineEntry[] {
    const graph = this.graph.snapshot(sessionId);
    const entries: TimelineEntry[] = [];

    for (const node of graph.nodes) {
      entries.push({
        timestamp: node.timestamp,
        kind: node.kind,
        nodeId: node.id,
        label: node.label,
        detail: node.data,
      });
    }

    for (const edge of graph.edges) {
      const from = graph.nodes.find((n) => n.id === edge.from);
      entries.push({
        timestamp: edge.timestamp,
        kind: edge.kind,
        label: `${edge.kind}: ${from?.label ?? edge.from}`,
        detail: { from: edge.from, to: edge.to, ...edge.metadata },
      });
    }

    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  explain(sessionId: string, ctx: StateGraphContext): RuntimeExplainResult {
    const blockers = this.blockers(sessionId, ctx);
    const failureCause = this.resolveFailureCause(sessionId, ctx, blockers);
    const success = this.isSuccess(sessionId, ctx, blockers);
    const graph = this.graph.snapshot(sessionId);

    const lines = [
      `Session ${sessionId.slice(0, 8)} — status: ${ctx.session.status}, success: ${success}`,
      `Mode: ${ctx.session.runtimeMode ?? ctx.runtimeMode}`,
      `Audits: ${graph.nodes.filter((n) => n.kind === 'Audit').length}, Plans: ${graph.nodes.filter((n) => n.kind === 'MutationPlan').length}`,
      `Executions: ${graph.nodes.filter((n) => n.kind === 'Execution').length}, Verifications: ${graph.nodes.filter((n) => n.kind === 'Verification').length}`,
    ];

    if (failureCause) {
      lines.push(`Failure cause: ${failureCause}`);
      if (ctx.session.failureReason) lines.push(`Reason: ${ctx.session.failureReason}`);
    }

    if (blockers.length > 0) {
      lines.push('', 'Blockers:');
      for (const b of blockers) {
        lines.push(`- [${b.kind}] ${b.message}`);
      }
    }

    const causal = this.causalView(sessionId);
    const causalSummary =
      causal.chains.length > 0
        ? causal.chains
            .map((c) =>
              [c.failure?.label, c.plan?.label, c.execution?.label, c.verification?.label]
                .filter(Boolean)
                .join(' → ')
            )
            .join('; ')
        : 'No failure chain recorded';

    return {
      sessionId,
      narrative: lines.join('\n'),
      status: ctx.session.status,
      success,
      failureCause,
      causalSummary,
      blockerCount: blockers.length,
    };
  }

  nextActions(sessionId: string, ctx: StateGraphContext): RuntimeNextAction[] {
    const blockers = this.blockers(sessionId, ctx);
    const actions: RuntimeNextAction[] = [];

    if (ctx.session.status === 'awaiting_approval') {
      actions.push({
        actionId: 'approve',
        label: 'Obtain human approval and execute',
        api: 'ctx.runtime.execute({ plan, approvedBy: "operator" })',
        requiresHumanApproval: true,
        allowedPolicies: ['human_approval_required'],
      });
    }

    for (const blocker of blockers) {
      actions.push(blocker.nextAction);
    }

    const lastAudit = ctx.session.audits[ctx.session.audits.length - 1];
    const lastPlan = ctx.session.repairPlans[ctx.session.repairPlans.length - 1];
    const lastExecution = ctx.session.executions[ctx.session.executions.length - 1];

    if (blockers.length > 0 && lastAudit && !lastPlan) {
      actions.push({
        actionId: 'plan-repairs',
        label: 'Generate mutation plan from audit',
        api: 'ctx.runtime.planRepairs({ audit, sessionId })',
        command: 'await ctx.runtime.planRepairs({ audit, sessionId })',
        requiresHumanApproval: false,
        allowedPolicies: ['autonomous_safe', 'ci_gate_only', 'human_approval_required'],
      });
    }

    if (lastPlan && !lastExecution && blockers.some((b) => b.kind === 'approval')) {
      actions.push({
        actionId: 'request-approval',
        label: 'Request approval before execution',
        api: 'ctx.runtime.requestApproval(plan)',
        requiresHumanApproval: true,
        allowedPolicies: ['human_approval_required'],
      });
    }

    if (lastPlan && !lastExecution && blockers.every((b) => b.kind !== 'approval')) {
      actions.push({
        actionId: 'execute-plan',
        label: 'Execute mutation plan',
        api: 'ctx.runtime.execute({ plan, sessionId })',
        command: lastPlan.requiredVerificationCommands[0],
        requiresHumanApproval: lastPlan.requiredApprovals.includes('human_approval_required'),
        allowedPolicies: lastPlan.requiredApprovals.length > 0 ? lastPlan.requiredApprovals : ['autonomous_safe'],
      });
    }

    if (lastExecution && ctx.session.status === 'verifying') {
      actions.push({
        actionId: 'verify',
        label: 'Run post-mutation verification',
        api: 'ctx.runtime.verify({ execution, sessionId })',
        command: 'await ctx.graph.spider.gate({ scope: "changed-files" })',
        requiresHumanApproval: false,
        allowedPolicies: ['ci_gate_only', 'autonomous_safe'],
      });
    }

    if (ctx.session.status === 'completed' && blockers.length === 0) {
      actions.push({
        actionId: 'done',
        label: 'Session complete — no further action required',
        requiresHumanApproval: false,
        allowedPolicies: [],
      });
    }

    if (actions.length === 0) {
      actions.push({
        actionId: 'audit',
        label: 'Run structural audit',
        command: 'await ctx.graph.spider.audit({ scope: "changed-files" })',
        api: 'ctx.graph.spider.audit({ scope: "changed-files", sessionId })',
        requiresHumanApproval: false,
        allowedPolicies: ['readonly', 'autonomous_safe', 'ci_gate_only'],
      });
    }

    const seen = new Set<string>();
    return actions.filter((a) => {
      if (seen.has(a.actionId)) return false;
      seen.add(a.actionId);
      return true;
    });
  }

  blockers(sessionId: string, ctx: StateGraphContext): RuntimeBlocker[] {
    const blockers: RuntimeBlocker[] = [];
    const graph = this.graph.snapshot(sessionId);

    for (const node of graph.nodes.filter((n) => n.kind === 'Finding')) {
      const finding = node.data as unknown as SpiderFinding;
      if (finding.severity === 'ERROR') {
        const directive = graph.nodes.find(
          (n) =>
            n.kind === 'RepairDirective' &&
            (n.data as unknown as RepairDirectiveData).targetFile === finding.filePath
        );
        blockers.push({
          blockerId: node.id,
          sessionId,
          kind: 'finding',
          severity: 'error',
          message: finding.message,
          cause: 'gate_blocked',
          findingId: finding.findingId,
          filePath: finding.filePath,
          nextAction: {
            actionId: `fix-${node.id}`,
            label: directive
              ? `Apply directive: ${(directive.data as unknown as RepairDirectiveData).type}`
              : `Investigate ${finding.diagnosticId}`,
            command: directive
              ? (directive.data as unknown as RepairDirectiveData).verificationCommand
              : `await ctx.graph.spider.explain(report, '${finding.findingId}')`,
            requiresHumanApproval: (directive?.data as unknown as RepairDirectiveData)?.riskLevel === 'high',
            allowedPolicies: this.policiesForRisk((directive?.data as unknown as RepairDirectiveData)?.riskLevel),
          },
        });
      }
    }

    for (const node of graph.nodes.filter((n) => n.kind === 'Gate')) {
      if ((node.data.exitCode as number) !== 0) {
        blockers.push({
          blockerId: node.id,
          sessionId,
          kind: 'gate',
          severity: 'error',
          message: 'Structural gate blocked progress',
          cause: 'gate_blocked',
          nextAction: {
            actionId: 're-gate',
            label: 'Re-run gate after repairs',
            command: 'await ctx.graph.spider.gate({ scope: "changed-files" })',
            requiresHumanApproval: false,
            allowedPolicies: ['ci_gate_only', 'autonomous_safe'],
          },
        });
      }
    }

    for (const node of graph.nodes.filter((n) => n.kind === 'PolicyViolation')) {
      blockers.push({
        blockerId: node.id,
        sessionId,
        kind: 'policy',
        severity: 'error',
        message: ((node.data.reasons as string[]) ?? []).join('; ') || 'Policy violation',
        cause: 'policy_violation',
        nextAction: {
          actionId: 'review-policy',
          label: 'Review policy or switch runtime mode',
          api: 'ctx.runtime.setMode("development")',
          requiresHumanApproval: true,
          allowedPolicies: ['human_approval_required'],
        },
      });
    }

    for (const node of graph.nodes.filter((n) => n.kind === 'BudgetViolation')) {
      blockers.push({
        blockerId: node.id,
        sessionId,
        kind: 'budget',
        severity: 'error',
        message: `Budget exceeded: ${node.data.reason}`,
        cause: 'budget_exceeded',
        nextAction: {
          actionId: 'new-session',
          label: 'Start new session with expanded budget',
          api: 'ctx.runtime.beginSession({ budget: { ... } })',
          requiresHumanApproval: true,
          allowedPolicies: ['human_approval_required'],
        },
      });
    }

    const failedVerification = graph.nodes.find(
      (n) => n.kind === 'Verification' && n.data.passed === false
    );
    if (failedVerification) {
      blockers.push({
        blockerId: failedVerification.id,
        sessionId,
        kind: 'verification',
        severity: 'error',
        message: 'Post-mutation verification failed',
        cause: 'verification_failed',
        nextAction: {
          actionId: 're-audit',
          label: 'Re-audit and inspect introduced findings',
          command: 'await ctx.graph.spider.audit({ scope: "changed-files" })',
          requiresHumanApproval: false,
          allowedPolicies: ['ci_gate_only'],
        },
      });
    }

    if (ctx.session.status === 'awaiting_approval') {
      blockers.push({
        blockerId: `approval:${sessionId}`,
        sessionId,
        kind: 'approval',
        severity: 'warn',
        message: 'Human approval required before execution',
        cause: 'approval_required',
        nextAction: {
          actionId: 'approve-execute',
          label: 'Approve and execute plan',
          api: 'ctx.runtime.execute({ plan, approvedBy: "operator" })',
          requiresHumanApproval: true,
          allowedPolicies: ['human_approval_required'],
        },
      });
    }

    return blockers;
  }

  openLoops(ctx: { sessions: ExecutionSession[] }): OpenLoop[] {
    const loops: OpenLoop[] = [];
    for (const session of ctx.sessions) {
      if (session.status === 'awaiting_approval') {
        loops.push({
          sessionId: session.sessionId,
          status: session.status,
          loopKind: 'awaiting_approval',
          message: 'Awaiting human approval',
          since: session.startedAt,
        });
      } else if (session.status === 'verifying') {
        loops.push({
          sessionId: session.sessionId,
          status: session.status,
          loopKind: 'verifying',
          message: 'Verification in progress or pending',
          since: session.startedAt,
        });
      } else if (session.status === 'running' || session.status === 'blocked') {
        const hasGateBlock = this.graph.getNodesByKind(session.sessionId, 'Gate').some(
          (g) => (g.data.exitCode as number) !== 0
        );
        loops.push({
          sessionId: session.sessionId,
          status: session.status,
          loopKind: hasGateBlock || session.status === 'blocked' ? 'blocked' : 'running',
          message: hasGateBlock || session.status === 'blocked' ? 'Gate blocked — repairs needed' : 'Session active',
          since: session.startedAt,
        });
      }
    }
    return loops;
  }

  causalView(sessionId: string): CausalChain {
    const graph = this.graph.snapshot(sessionId);
    const failures = graph.nodes.filter(
      (n) =>
        n.kind === 'RuntimeEvent' &&
        typeof n.data.cause === 'string' &&
        String(n.label).startsWith('Failure:')
    );

    const chains = failures.map((failure) => {
      const relatedEdges = graph.edges.filter((e) => e.from === failure.id || e.to === failure.id);
      const relatedIds = new Set(relatedEdges.flatMap((e) => [e.from, e.to]));
      const related = graph.nodes.filter((n) => relatedIds.has(n.id));
      return {
        failure,
        evidence: related.filter((n) => n.kind === 'Finding'),
        directive: related.find((n) => n.kind === 'RepairDirective'),
        plan: related.find((n) => n.kind === 'MutationPlan'),
        execution: related.find((n) => n.kind === 'Execution'),
        verification: related.find((n) => n.kind === 'Verification'),
        rollback: related.find((n) => n.kind === 'Rollback'),
      };
    });

    if (chains.length === 0) {
      const lastVerification = [...graph.nodes].reverse().find((n) => n.kind === 'Verification');
      if (lastVerification && lastVerification.data.passed === false) {
        const execEdge = graph.edges.find((e) => e.to === lastVerification.id);
        const execution = execEdge ? graph.nodes.find((n) => n.id === execEdge.from) : undefined;
        const planEdge = execution ? graph.edges.find((e) => e.to === execution.id) : undefined;
        const plan = planEdge ? graph.nodes.find((n) => n.id === planEdge.from) : undefined;
        chains.push({
          failure: lastVerification,
          evidence: graph.nodes.filter((n) => n.kind === 'Finding'),
          directive: undefined,
          verification: lastVerification,
          execution,
          plan,
          rollback: undefined,
        });
      }
    }

    return { sessionId, chains };
  }

  diffView(sessionId: string, ctx: StateGraphContext): DiffView {
    const lastVerification = ctx.session.verifications[ctx.session.verifications.length - 1];
    if (lastVerification) {
      return {
        sessionId,
        introduced: lastVerification.introducedFindings,
        resolved: lastVerification.resolvedFindings,
        remaining: lastVerification.remainingFindings,
        diff: lastVerification.diff,
      };
    }
    const lastAudit = ctx.session.audits[ctx.session.audits.length - 1];
    return {
      sessionId,
      introduced: lastAudit?.findings ?? [],
      resolved: [],
      remaining: lastAudit?.findings ?? [],
      diff: null,
    };
  }

  export(sessionId: string, ctx: StateGraphContext, options: RuntimeExportOptions): RuntimeExportResult {
    const state = this.state(sessionId, ctx);
    const timeline = this.timeline(sessionId);
    const explain = this.explain(sessionId, ctx);
    const next = this.nextActions(sessionId, ctx);
    const blockers = this.blockers(sessionId, ctx);

    if (options.format === 'json') {
      return {
        sessionId,
        format: 'json',
        content: JSON.stringify(
          { state, timeline, explain, nextActions: next, blockers, causal: this.causalView(sessionId) },
          null,
          2
        ),
      };
    }

    if (options.format === 'markdown') {
      const md = [
        `# Runtime Session ${sessionId.slice(0, 8)}`,
        '',
        explain.narrative,
        '',
        '## Next Actions',
        ...next.map((a) => `- **${a.label}**${a.command ? `: \`${a.command}\`` : ''}`),
        '',
        '## Timeline',
        ...timeline.map((t) => `- ${new Date(t.timestamp).toISOString()} ${t.label}`),
      ];
      return { sessionId, format: 'markdown', content: md.join('\n') };
    }

    const sarif = {
      version: '2.1.0',
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      runs: [
        {
          tool: { driver: { name: 'BroccoliDB Runtime', version: 'v28' } },
          results: blockers.map((b) => ({
            ruleId: b.cause,
            level: b.severity === 'error' ? 'error' : 'warning',
            message: { text: b.message },
            locations: b.filePath ? [{ physicalLocation: { artifactLocation: { uri: b.filePath } } }] : [],
          })),
        },
      ],
    };
    return { sessionId, format: 'sarif', content: JSON.stringify(sarif, null, 2) };
  }

  private isSuccess(sessionId: string, ctx: StateGraphContext, blockers: RuntimeBlocker[]): boolean {
    if (ctx.session.status !== 'completed') return false;
    if (blockers.length > 0) return false;
    const failedVerification = this.graph
      .getNodesByKind(sessionId, 'Verification')
      .some((n) => n.data.passed === false);
    if (failedVerification) return false;
    const budgetViolation = this.graph.getNodesByKind(sessionId, 'BudgetViolation').length > 0;
    if (budgetViolation) return false;
    const gateBlocked = this.graph
      .getNodesByKind(sessionId, 'Gate')
      .some((g) => (g.data.exitCode as number) !== 0);
    if (gateBlocked) return false;
    const lastVerification = ctx.session.verifications[ctx.session.verifications.length - 1];
    return lastVerification?.passed === true;
  }

  private resolveFailureCause(
    _sessionId: string,
    ctx: StateGraphContext,
    blockers: RuntimeBlocker[]
  ): FailureCause | undefined {
    if (ctx.session.status === 'completed' && blockers.length === 0) return undefined;
    if (blockers.some((b) => b.cause === 'budget_exceeded')) return 'budget_exceeded';
    if (blockers.some((b) => b.cause === 'policy_violation')) return 'policy_violation';
    if (blockers.some((b) => b.cause === 'verification_failed')) return 'verification_failed';
    if (blockers.some((b) => b.cause === 'gate_blocked')) return 'gate_blocked';
    if (blockers.some((b) => b.cause === 'approval_required')) return 'approval_required';
    if (ctx.session.status === 'failed') return 'execution_failed';
    if (ctx.session.status === 'rolled_back') return 'rollback_failed';
    if (blockers.length > 0) return 'open_blockers';
    return undefined;
  }

  private policiesForRisk(risk?: string): ApprovalPolicy[] {
    if (risk === 'high') return ['human_approval_required'];
    if (risk === 'medium') return ['ci_gate_only', 'human_approval_required'];
    return ['autonomous_safe', 'ci_gate_only'];
  }
}

interface RepairDirectiveData {
  type: string;
  targetFile: string;
  verificationCommand?: string;
  riskLevel?: string;
}
