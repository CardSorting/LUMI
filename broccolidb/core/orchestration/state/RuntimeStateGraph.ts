// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type {
  ApprovalPolicy,
  ExecutionSessionStatus,
  MutationPlan,
  PolicyDecision,
  RepairExecution,
  VerificationResult,
} from '../types.js';
import type { CapabilityIntent } from '../../agent-context/intent-types.js';
import type { RuntimeEvent, RuntimeMode } from '../runtime/types.js';
import type { RepairDirective, SpiderFinding, SpiderReport } from '../../policy/spider/report-types.js';
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  RuntimeStateGraphSnapshot,
} from './types.js';

export class RuntimeStateGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];
  private readonly sessionNodes = new Map<string, Set<string>>();
  private readonly auditToFindings = new Map<string, string[]>();
  private readonly planToAudit = new Map<string, string>();
  private readonly executionToPlan = new Map<string, string>();
  private readonly verificationToExecution = new Map<string, string>();
  private readonly rollbackToSource = new Map<string, string>();

  addNode(
    kind: GraphNodeKind,
    sessionId: string,
    label: string,
    data: Record<string, unknown>,
    id?: string,
    timestamp?: number
  ): GraphNode {
    const node: GraphNode = {
      id: id ?? randomUUID(),
      kind,
      sessionId,
      timestamp: timestamp ?? Date.now(),
      label,
      data,
    };
    this.nodes.set(node.id, node);
    if (!this.sessionNodes.has(sessionId)) {
      this.sessionNodes.set(sessionId, new Set());
    }
    this.sessionNodes.get(sessionId)!.add(node.id);
    return node;
  }

  link(from: string, to: string, kind: GraphEdgeKind, metadata?: Record<string, unknown>): GraphEdge {
    const edge: GraphEdge = {
      id: randomUUID(),
      from,
      to,
      kind,
      timestamp: Date.now(),
      metadata,
    };
    this.edges.push(edge);
    return edge;
  }

  linkSession(nodeId: string, sessionNodeId: string): void {
    this.link(nodeId, sessionNodeId, 'belongs_to_session');
  }

  recordSession(session: {
    sessionId: string;
    startedAt: number;
    taskId?: string;
    agentId?: string;
    runtimeMode?: RuntimeMode;
    status: ExecutionSessionStatus;
  }): string {
    const node = this.addNode(
      'Session',
      session.sessionId,
      `Session ${session.sessionId.slice(0, 8)}`,
      {
        taskId: session.taskId,
        agentId: session.agentId,
        runtimeMode: session.runtimeMode,
        status: session.status,
      },
      `session:${session.sessionId}`,
      session.startedAt
    );
    return node.id;
  }

  updateSessionStatus(sessionId: string, status: ExecutionSessionStatus, extra?: Record<string, unknown>): void {
    const node = this.nodes.get(`session:${sessionId}`);
    if (node) {
      node.data.status = status;
      Object.assign(node.data, extra ?? {});
    }
  }

  recordIntent(sessionId: string, sessionNodeId: string, intent: CapabilityIntent): string {
    const node = this.addNode('Intent', sessionId, `${intent.capability}.${intent.operation}`, {
      intentId: intent.id,
      capability: intent.capability,
      operation: intent.operation,
      priority: intent.priority,
    }, `intent:${intent.id}`, intent.createdAt);
    this.linkSession(node.id, sessionNodeId);
    this.link(node.id, sessionNodeId, 'triggered');
    return node.id;
  }

  recordAudit(sessionId: string, sessionNodeId: string, audit: SpiderReport): string {
    const auditNode = this.addNode(
      'Audit',
      sessionId,
      `Audit ${audit.reportId}`,
      { reportId: audit.reportId, verdict: audit.verdict, passed: audit.passed, scope: audit.scope },
      `audit:${audit.reportId}`,
      Date.parse(audit.generatedAt) || Date.now()
    );
    this.linkSession(auditNode.id, sessionNodeId);
    this.link(auditNode.id, sessionNodeId, 'created');

    const findingIds: string[] = [];
    for (const finding of audit.findings) {
      const findingId = finding.findingId ?? randomUUID();
      const fNode = this.addNode(
        'Finding',
        sessionId,
        `${finding.diagnosticId}: ${finding.filePath}`,
        { ...finding, findingId },
        `finding:${findingId}`
      );
      findingIds.push(fNode.id);
      this.linkSession(fNode.id, sessionNodeId);
      this.link(auditNode.id, fNode.id, 'introduced');
    }
    this.auditToFindings.set(audit.reportId, findingIds);

    for (const directive of audit.repairDirectives ?? []) {
      const dNode = this.addNode(
        'RepairDirective',
        sessionId,
        `${directive.type}: ${directive.targetFile}`,
        directive as unknown as Record<string, unknown>,
        `directive:${directive.directiveId}`
      );
      this.linkSession(dNode.id, sessionNodeId);
      this.link(auditNode.id, dNode.id, 'triggered');
      const relatedFinding = audit.findings.find((f) =>
        directive.supportingEvidenceIds.some((id) => f.evidence.some((e) => e.diagnosticId === id))
      );
      if (relatedFinding) {
        const fid = relatedFinding.findingId ?? `finding:${relatedFinding.filePath}`;
        const fNodeId = `finding:${fid}`;
        if (this.nodes.has(fNodeId)) {
          this.link(fNodeId, dNode.id, 'triggered');
        }
      }
    }

    return auditNode.id;
  }

  recordGate(sessionId: string, sessionNodeId: string, exitCode: number, auditReportId?: string): string {
    const node = this.addNode('Gate', sessionId, exitCode === 0 ? 'Gate passed' : 'Gate blocked', { exitCode });
    this.linkSession(node.id, sessionNodeId);
    if (exitCode !== 0 && auditReportId) {
      const auditNodeId = `audit:${auditReportId}`;
      if (this.nodes.has(auditNodeId)) {
        this.link(node.id, auditNodeId, 'blocked_by');
      }
    }
    return node.id;
  }

  recordPlan(sessionId: string, sessionNodeId: string, plan: MutationPlan, auditReportId: string): string {
    const node = this.addNode(
      'MutationPlan',
      sessionId,
      `Plan ${plan.planId.slice(0, 8)} (${plan.steps.length} steps)`,
      {
        planId: plan.planId,
        estimatedRisk: plan.estimatedRisk,
        affectedFiles: plan.affectedFiles,
        stepCount: plan.steps.length,
      },
      `plan:${plan.planId}`,
      plan.createdAt
    );
    this.linkSession(node.id, sessionNodeId);
    this.planToAudit.set(plan.planId, auditReportId);
    const auditNodeId = `audit:${auditReportId}`;
    if (this.nodes.has(auditNodeId)) {
      this.link(auditNodeId, node.id, 'triggered');
    }
    for (const directive of plan.directives) {
      const dId = `directive:${directive.directiveId}`;
      if (this.nodes.has(dId)) {
        this.link(dId, node.id, 'triggered');
      }
    }
    return node.id;
  }

  recordApproval(sessionId: string, planId: string, decision: PolicyDecision, approvedBy?: string): string {
    const node = this.addNode('ApprovalDecision', sessionId, decision.allowed ? 'Approved' : 'Denied', {
      ...decision,
      approvedBy,
    });
    const planNodeId = `plan:${planId}`;
    if (this.nodes.has(planNodeId)) {
      this.link(node.id, planNodeId, 'approved_by');
    }
    return node.id;
  }

  recordExecution(sessionId: string, sessionNodeId: string, execution: RepairExecution): string {
    const node = this.addNode(
      'Execution',
      sessionId,
      `Execution ${execution.executionId.slice(0, 8)}`,
      { ...execution },
      `execution:${execution.executionId}`,
      execution.startedAt
    );
    this.linkSession(node.id, sessionNodeId);
    this.executionToPlan.set(execution.executionId, execution.planId);
    const planNodeId = `plan:${execution.planId}`;
    if (this.nodes.has(planNodeId)) {
      this.link(planNodeId, node.id, 'executed_by');
    }
    return node.id;
  }

  recordVerification(
    sessionId: string,
    executionId: string,
    result: VerificationResult
  ): string {
    const node = this.addNode(
      'Verification',
      sessionId,
      result.passed ? 'Verification passed' : 'Verification failed',
      { ...result },
      `verification:${result.verificationId}`,
      result.verifiedAt
    );
    this.verificationToExecution.set(result.verificationId, executionId);
    const execNodeId = `execution:${executionId}`;
    if (this.nodes.has(execNodeId)) {
      this.link(execNodeId, node.id, 'verified_by');
    }
    for (const f of result.introducedFindings) {
      const fid = f.findingId ?? randomUUID();
      const fNode = this.addNode('Finding', sessionId, `introduced: ${f.message}`, { ...f, findingId: fid });
      this.link(node.id, fNode.id, 'introduced');
    }
    for (const f of result.resolvedFindings) {
      const fid = f.findingId ?? randomUUID();
      const fNode = this.addNode('Finding', sessionId, `resolved: ${f.message}`, { ...f, findingId: fid });
      this.link(node.id, fNode.id, 'resolved');
    }
    return node.id;
  }

  recordRollback(sessionId: string, sourceNodeId: string, reason: string, restored: string[]): string {
    const node = this.addNode('Rollback', sessionId, `Rollback: ${reason}`, { reason, restored });
    this.link(node.id, sourceNodeId, 'rolled_back_by');
    this.rollbackToSource.set(node.id, sourceNodeId);
    return node.id;
  }

  recordBudgetViolation(sessionId: string, reason: string): string {
    return this.addNode('BudgetViolation', sessionId, `Budget exceeded: ${reason}`, { reason }).id;
  }

  recordPolicyViolation(sessionId: string, reasons: string[]): string {
    return this.addNode('PolicyViolation', sessionId, 'Policy violation', { reasons }).id;
  }

  recordRuntimeEvent(sessionId: string, sessionNodeId: string, event: RuntimeEvent): string {
    const node = this.addNode('RuntimeEvent', sessionId, event.kind, { ...event });
    this.linkSession(node.id, sessionNodeId);
    return node.id;
  }

  recordHealthSnapshot(sessionId: string, health: Record<string, unknown>): string {
    const node = this.addNode('HealthSnapshot', sessionId, 'Health snapshot', health);
    const sessionNodeId = this.getSessionNodeId(sessionId);
    if (sessionNodeId) {
      this.linkSession(node.id, sessionNodeId);
    }
    return node.id;
  }

  recordReplay(sessionId: string, sessionNodeId: string): string {
    const node = this.addNode('Replay', sessionId, 'Forensic replay', { readonly: true });
    this.link(node.id, sessionNodeId, 'replayed_from');
    return node.id;
  }

  recordFailure(sessionId: string, sourceNodeId: string, cause: string, message: string): void {
    const node = this.addNode('RuntimeEvent', sessionId, `Failure: ${cause}`, { cause, message });
    this.link(node.id, sourceNodeId, 'failed_due_to');
  }

  snapshot(sessionId: string): RuntimeStateGraphSnapshot {
    const nodeIds = this.sessionNodes.get(sessionId) ?? new Set();
    const nodes = [...nodeIds].map((id) => this.nodes.get(id)!).filter(Boolean);
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const edges = this.edges.filter((e) => nodeIdSet.has(e.from) || nodeIdSet.has(e.to));
    return { sessionId, nodes, edges, generatedAt: Date.now() };
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getSessionNodeId(sessionId: string): string | undefined {
    return this.nodes.has(`session:${sessionId}`) ? `session:${sessionId}` : undefined;
  }

  getNodesByKind(sessionId: string, kind: GraphNodeKind): GraphNode[] {
    const ids = this.sessionNodes.get(sessionId) ?? new Set();
    return [...ids].map((id) => this.nodes.get(id)!).filter((n) => n?.kind === kind);
  }

  getSessionIds(): string[] {
    return [...this.sessionNodes.keys()];
  }

  hydrate(sessionId: string, nodes: GraphNode[], edges: GraphEdge[]): void {
    this.clearSession(sessionId);
    for (const node of nodes) {
      this.nodes.set(node.id, { ...node, sessionId });
      if (!this.sessionNodes.has(sessionId)) {
        this.sessionNodes.set(sessionId, new Set());
      }
      this.sessionNodes.get(sessionId)!.add(node.id);
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
        this.edges.push({ ...edge });
      }
    }
  }

  clearSession(sessionId: string): void {
    const ids = this.sessionNodes.get(sessionId);
    if (!ids) return;
    for (const id of ids) {
      this.nodes.delete(id);
    }
    this.sessionNodes.delete(sessionId);
    const remaining = this.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
    this.edges.length = 0;
    this.edges.push(...remaining);
  }

  clear(): void {
    this.nodes.clear();
    this.edges.length = 0;
    this.sessionNodes.clear();
    this.auditToFindings.clear();
    this.planToAudit.clear();
    this.executionToPlan.clear();
    this.verificationToExecution.clear();
    this.rollbackToSource.clear();
  }
}
