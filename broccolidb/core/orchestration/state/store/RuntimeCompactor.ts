// [LAYER: CORE]
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import type { RuntimeSnapshotStore } from './RuntimeSnapshotStore.js';
import type { CompactionResult } from './types.js';
import type { RuntimeMode } from '../../runtime/types.js';

export class RuntimeCompactor {
  constructor(private readonly snapshotStore: RuntimeSnapshotStore) {}

  async compact(
    graph: RuntimeStateGraph,
    sessionId: string,
    mode: RuntimeMode
  ): Promise<CompactionResult> {
    const before = graph.snapshot(sessionId);
    const beforeCount = before.nodes.length;

    const snapshot = await this.snapshotStore.save(graph, sessionId, mode, {
      compressed: true,
      metadata: {
        compactionSummary: `Archived ${beforeCount} nodes; session summarized`,
        preCompactionNodeCount: beforeCount,
      },
    });

    const sessionNode = before.nodes.find((n) => n.kind === 'Session');
    const summaryNode = graph.addNode(
      'HealthSnapshot',
      sessionId,
      'Compaction summary',
      {
        snapshotId: snapshot.snapshotId,
        archivedNodeCount: beforeCount,
        compactedAt: Date.now(),
        replayable: true,
      }
    );
    if (sessionNode) {
      graph.link(summaryNode.id, sessionNode.id, 'belongs_to_session');
    }

    const after = graph.snapshot(sessionId);

    return {
      sessionId,
      beforeNodes: beforeCount,
      afterNodes: after.nodes.length,
      snapshotId: snapshot.snapshotId,
      replayable: true,
    };
  }
}
