// [LAYER: CORE]
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import type { RuntimeOperator } from '../RuntimeOperator.js';
import type { ExecutionSession } from '../../types.js';
import type { RuntimeBlocker, StateGraphContext } from '../types.js';

export class RuntimeIndex {
  private readonly taskIndex = new Map<string, Set<string>>();
  private readonly directiveIndex = new Map<string, Set<string>>();
  private readonly failureRules = new Map<string, Set<string>>();

  indexSession(session: ExecutionSession, graph: RuntimeStateGraph): void {
    if (session.taskId) {
      if (!this.taskIndex.has(session.taskId)) this.taskIndex.set(session.taskId, new Set());
      this.taskIndex.get(session.taskId)!.add(session.sessionId);
    }

    const directives = graph.getNodesByKind(session.sessionId, 'RepairDirective');
    for (const d of directives) {
      const type = String(d.data.type ?? 'unknown');
      if (!this.directiveIndex.has(type)) this.directiveIndex.set(type, new Set());
      this.directiveIndex.get(type)!.add(session.sessionId);
    }

    const failures = graph.getNodesByKind(session.sessionId, 'RuntimeEvent').filter((n) =>
      String(n.label).startsWith('Failure:')
    );
    for (const f of failures) {
      const cause = String(f.data.cause ?? 'unknown');
      if (!this.failureRules.has(cause)) this.failureRules.set(cause, new Set());
      this.failureRules.get(cause)!.add(session.sessionId);
    }
  }

  sessionsByTask(taskId: string): string[] {
    return [...(this.taskIndex.get(taskId) ?? [])];
  }

  failuresByRule(ruleId: string): string[] {
    return [...(this.failureRules.get(ruleId) ?? [])];
  }

  executionsByDirective(type: string): string[] {
    return [...(this.directiveIndex.get(type) ?? [])];
  }

  unresolvedBlockers(operator: RuntimeOperator, sessions: ExecutionSession[]): RuntimeBlocker[] {
    return sessions.flatMap((s) =>
      operator.blockers(s.sessionId, {
        session: s,
        health: { status: 'healthy' } as StateGraphContext['health'],
        runtimeMode: s.runtimeMode ?? 'development',
        events: [],
      })
    );
  }

  rollbackFrequency(graph: RuntimeStateGraph, sessionIds: string[]): number {
    let count = 0;
    for (const id of sessionIds) {
      count += graph.getNodesByKind(id, 'Rollback').length;
    }
    return count;
  }

  policyViolations(graph: RuntimeStateGraph, sessionIds: string[]): number {
    let count = 0;
    for (const id of sessionIds) {
      count += graph.getNodesByKind(id, 'PolicyViolation').length;
    }
    return count;
  }

  driftHotspots(graph: RuntimeStateGraph, sessionIds: string[]): string[] {
    const files = new Set<string>();
    for (const id of sessionIds) {
      for (const f of graph.getNodesByKind(id, 'Finding')) {
        const fp = f.data.filePath;
        if (typeof fp === 'string') files.add(fp);
      }
    }
    return [...files];
  }

  clear(): void {
    this.taskIndex.clear();
    this.directiveIndex.clear();
    this.failureRules.clear();
  }
}
