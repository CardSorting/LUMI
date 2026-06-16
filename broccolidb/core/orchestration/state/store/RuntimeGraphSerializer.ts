// [LAYER: CORE]
import { createHash } from 'node:crypto';
import type { GraphEdge, GraphNode } from '../types.js';
import { RUNTIME_GRAPH_SCHEMA_VERSION, type SerializedRuntimeGraph } from './types.js';

export class RuntimeGraphSerializer {
  serialize(sessionId: string, nodes: GraphNode[], edges: GraphEdge[], options?: { compacted?: boolean; compactionSummary?: string }): SerializedRuntimeGraph {
    const canonical = this.canonicalPayload(sessionId, nodes, edges, options);
    const graphHash = createHash('sha256').update(canonical).digest('hex');
    return {
      schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION,
      sessionId,
      nodes,
      edges,
      graphHash,
      ...(options?.compacted ? { compacted: true, compactionSummary: options.compactionSummary } : {}),
    };
  }

  deserialize(payload: string | SerializedRuntimeGraph): SerializedRuntimeGraph {
    const graph = typeof payload === 'string' ? (JSON.parse(payload) as SerializedRuntimeGraph) : payload;
    const expected = createHash('sha256')
      .update(this.canonicalPayload(graph.sessionId, graph.nodes, graph.edges, graph))
      .digest('hex');
    if (graph.graphHash !== expected) {
      throw new Error(`RTG-005 SnapshotCorruption: graph hash mismatch (expected ${expected.slice(0, 8)}, got ${graph.graphHash.slice(0, 8)})`);
    }
    return graph;
  }

  private canonicalPayload(
    sessionId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    options?: { compacted?: boolean; compactionSummary?: string }
  ): string {
    const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify({
      sessionId,
      nodes: sortedNodes,
      edges: sortedEdges,
      compacted: options?.compacted ?? false,
      compactionSummary: options?.compactionSummary ?? null,
    });
  }
}
