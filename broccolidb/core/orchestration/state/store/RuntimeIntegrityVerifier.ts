// [LAYER: CORE]
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import type { GraphNodeKind } from '../types.js';
import type { ExecutionSession } from '../../types.js';
import type { IntegrityReport, IntegrityViolation, RuntimeGraphDiagnosticId } from './types.js';

export class RuntimeIntegrityVerifier {
  verify(graph: RuntimeStateGraph, sessionId: string, session?: ExecutionSession): IntegrityReport {
    const violations: IntegrityViolation[] = [];
    const snapshot = graph.snapshot(sessionId);
    const nodeIds = new Set(snapshot.nodes.map((n) => n.id));
    const sessionNodeId = graph.getSessionNodeId(sessionId);

    for (const node of snapshot.nodes) {
      if (node.kind !== 'Session' && sessionNodeId) {
        const belongs = snapshot.edges.some(
          (e) => e.kind === 'belongs_to_session' && e.from === node.id && e.to === sessionNodeId
        );
        const linked = snapshot.edges.some((e) => e.from === node.id || e.to === node.id);
        if (!belongs && !linked && node.sessionId === sessionId) {
          violations.push({
            diagnosticId: 'RTG-001',
            message: `Orphaned node ${node.id} (${node.kind})`,
            nodeId: node.id,
            sessionId,
          });
        }
      }
    }

    for (const edge of snapshot.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        violations.push({
          diagnosticId: 'RTG-002',
          message: `Dangling edge ${edge.id}: ${edge.from} -> ${edge.to}`,
          edgeId: edge.id,
          sessionId,
        });
      }
    }

    this.verifyExecutionChain(snapshot.nodes, snapshot.edges, violations, sessionId);
    this.verifyRollbackLinks(snapshot.nodes, snapshot.edges, violations, sessionId);
    this.verifyVerificationChain(snapshot.nodes, snapshot.edges, violations, sessionId);

    if (session?.status === 'completed') {
      const openErrors = snapshot.nodes.filter(
        (n) => n.kind === 'Finding' && (n.data as { severity?: string }).severity === 'ERROR'
      );
      const failedGate = snapshot.nodes.some(
        (n) => n.kind === 'Gate' && (n.data as { exitCode?: number }).exitCode !== 0
      );
      const failedVerification = snapshot.nodes.some(
        (n) => n.kind === 'Verification' && n.data.passed === false
      );
      if (openErrors.length > 0 || failedGate || failedVerification) {
        violations.push({
          diagnosticId: 'RTG-008',
          message: 'Session marked complete but blockers or failures remain in graph',
          sessionId,
        });
      }
    }

    return {
      healthy: violations.length === 0,
      violations,
      checkedAt: Date.now(),
    };
  }

  private verifyExecutionChain(
    nodes: ReturnType<RuntimeStateGraph['snapshot']>['nodes'],
    edges: ReturnType<RuntimeStateGraph['snapshot']>['edges'],
    violations: IntegrityViolation[],
    sessionId: string
  ): void {
    for (const exec of nodes.filter((n) => n.kind === 'Execution')) {
      const planEdge = edges.find((e) => e.to === exec.id && e.kind === 'executed_by');
      if (!planEdge) {
        violations.push({
          diagnosticId: 'RTG-003',
          message: `Execution ${exec.id} has no plan linkage`,
          nodeId: exec.id,
          sessionId,
        });
        continue;
      }
      const plan = nodes.find((n) => n.id === planEdge.from);
      if (!plan || plan.kind !== 'MutationPlan') {
        violations.push({
          diagnosticId: 'RTG-003',
          message: `Invalid execution chain for ${exec.id}`,
          nodeId: exec.id,
          sessionId,
        });
      }
    }

    for (const plan of nodes.filter((n) => n.kind === 'MutationPlan')) {
      const auditEdge = edges.find((e) => e.to === plan.id && e.kind === 'triggered');
      if (!auditEdge) {
        violations.push({
          diagnosticId: 'RTG-003',
          message: `Plan ${plan.id} not linked to audit`,
          nodeId: plan.id,
          sessionId,
        });
      }
    }
  }

  private verifyRollbackLinks(
    nodes: ReturnType<RuntimeStateGraph['snapshot']>['nodes'],
    edges: ReturnType<RuntimeStateGraph['snapshot']>['edges'],
    violations: IntegrityViolation[],
    sessionId: string
  ): void {
    for (const rb of nodes.filter((n) => n.kind === 'Rollback')) {
      const link = edges.find((e) => e.from === rb.id && e.kind === 'rolled_back_by');
      if (!link) {
        violations.push({
          diagnosticId: 'RTG-006',
          message: `Rollback ${rb.id} missing rolled_back_by link`,
          nodeId: rb.id,
          sessionId,
        });
      }
    }
  }

  private verifyVerificationChain(
    nodes: ReturnType<RuntimeStateGraph['snapshot']>['nodes'],
    edges: ReturnType<RuntimeStateGraph['snapshot']>['edges'],
    violations: IntegrityViolation[],
    sessionId: string
  ): void {
    for (const ver of nodes.filter((n) => n.kind === 'Verification')) {
      const link = edges.find((e) => e.to === ver.id && e.kind === 'verified_by');
      if (!link) {
        violations.push({
          diagnosticId: 'RTG-007',
          message: `Verification ${ver.id} not linked to execution`,
          nodeId: ver.id,
          sessionId,
        });
      }
    }
  }
}
