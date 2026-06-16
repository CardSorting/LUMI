// [LAYER: CORE]
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import type { RuntimeOperator } from '../RuntimeOperator.js';
import type { StateGraphContext } from '../types.js';
import type { RuntimeStory as StoreRuntimeStory } from './types.js';

export class RuntimeStoryBuilder {
  constructor(
    private readonly graph: RuntimeStateGraph,
    private readonly operator: RuntimeOperator
  ) {}

  build(sessionId: string, ctx: StateGraphContext): StoreRuntimeStory {
    const snap = this.graph.snapshot(sessionId);
    const explain = this.operator.explain(sessionId, ctx);
    const blockers = this.operator.blockers(sessionId, ctx);
    const diff = this.operator.diffView(sessionId, ctx);
    const causal = this.operator.causalView(sessionId);

    const whatHappened: string[] = [];
    for (const kind of ['Session', 'Audit', 'MutationPlan', 'Execution', 'Verification', 'Rollback'] as const) {
      const nodes = snap.nodes.filter((n) => n.kind === kind);
      if (nodes.length > 0) {
        whatHappened.push(`${kind}: ${nodes.map((n) => n.label).join('; ')}`);
      }
    }

    const why = blockers.map((b) => `${b.cause}: ${b.message}`);
    if (why.length === 0 && explain.failureCause) {
      why.push(explain.failureCause);
    }

    const whatChanged = [
      ...diff.introduced.map((f) => `introduced: ${f.message}`),
      ...diff.resolved.map((f) => `resolved: ${f.message}`),
    ];

    const whatFailed = snap.nodes
      .filter((n) => n.kind === 'RuntimeEvent' && String(n.label).startsWith('Failure:'))
      .map((n) => String(n.data.message ?? n.label));

    const whatRecovered = snap.nodes
      .filter((n) => n.kind === 'Rollback')
      .map((n) => `restored: ${((n.data.restored as string[]) ?? []).join(', ')}`);

    const whatRemainsBlocked = blockers.map((b) => b.message);

    const narrative = [
      explain.narrative,
      '',
      'Causal chain:',
      causal.chains.map((c) => explain.causalSummary).join('\n') || '(none)',
      '',
      'Blocked:',
      whatRemainsBlocked.length > 0 ? whatRemainsBlocked.join('\n') : '(none)',
    ].join('\n');

    return {
      sessionId,
      narrative,
      whatHappened,
      why,
      whatChanged,
      whatFailed,
      whatRecovered,
      whatRemainsBlocked,
      generatedAt: Date.now(),
    };
  }
}
