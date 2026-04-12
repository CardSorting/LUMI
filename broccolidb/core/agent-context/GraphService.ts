import type { WriteOp } from '../../infrastructure/db/BufferedDbPool.js';
import { AgentGitError } from '../errors.js';
import type { GraphEdge, KnowledgeBaseItem, ServiceContext, TraversalFilter } from './types.js';

/**
 * GraphService manages the BroccoliDB knowledge graph, including traversal,
 * consistency checks, and structural modifications.
 */
export class GraphService {
  constructor(private ctx: ServiceContext) {}

  async addKnowledge(
    kbId: string,
    type: KnowledgeBaseItem['type'],
    content: string,
    options: {
      tags?: string[];
      edges?: GraphEdge[];
      embedding?: number[];
      confidence?: number;
      expiresAt?: number;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<string> {
    const results = await this.addKnowledgeBatch([{ kbId, type, content, options }]);
    return results[0]!;
  }

  async addKnowledgeBatch(
    items: {
      kbId: string;
      type: KnowledgeBaseItem['type'];
      content: string;
      options?: {
        tags?: string[];
        edges?: GraphEdge[];
        embedding?: number[];
        confidence?: number;
        expiresAt?: number;
        metadata?: Record<string, any>;
      };
    }[]
  ): Promise<string[]> {
    if (items.length === 0) return [];

    const generatedIds = items.map((it) => (it.kbId === 'auto' ? crypto.randomUUID() : it.kbId));
    const allOps: WriteOp[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const id = generatedIds[i]!;
      const options = it.options || {};
      const edges = options.edges || [];

      // Scaling via Unified CAS (Content-Addressable Storage)
      // If content > 1024, it's replaced with a hash.
      let scaledContent = it.content;
      let isReference = false;
      if (it.content.length > 1024) {
          const hash = await this.ctx.storage.writeBlob(it.content);
          scaledContent = `CAS:${hash}`;
          isReference = true;
      }

      allOps.push({
        type: 'upsert',
        table: 'knowledge',
        values: {
          id,
          userId: this.ctx.userId,
          type: it.type,
          content: scaledContent,
          tags: JSON.stringify(options.tags || []),
          embedding: options.embedding ? JSON.stringify(options.embedding) : null,
          confidence: options.confidence ?? 1.0,
          hubScore: edges.length,
          expiresAt: options.expiresAt || null,
          metadata: JSON.stringify({ ...options.metadata, isReference }),
          createdAt: Date.now(),
        },
        layer: 'domain',
      });

      for (const edge of edges) {
        allOps.push({
          type: 'upsert',
          table: 'knowledge_edges',
          values: {
            sourceId: id,
            targetId: edge.targetId,
            type: edge.type,
            weight: edge.weight ?? 1.0,
          },
          layer: 'domain',
        });
      }
    }

    await this.ctx.pushBatch(allOps);
    return generatedIds;
  }

  async mergeKnowledge(sourceId: string, targetId: string): Promise<void> {
    const source = await this.getKnowledge(sourceId);
    const target = await this.getKnowledge(targetId);

    const mergedTags = Array.from(new Set([...target.tags, ...source.tags]));
    const mergedContent = `${target.content}\n---\n${source.content}`;

    const mergedEdges = [...(target.edges || [])];
    for (const e of source.edges || []) {
      if (
        e.targetId !== targetId &&
        !mergedEdges.some((m) => m.targetId === e.targetId && m.type === e.type)
      ) {
        mergedEdges.push(e);
      }
    }
    const cleanedEdges = mergedEdges.filter((e) => e.targetId !== sourceId);
    const mergedConfidence = (target.confidence + source.confidence) / 2;

    if (source.inboundEdges && source.inboundEdges.length > 0) {
      for (const inEdge of source.inboundEdges) {
        if (inEdge.targetId === targetId) continue;
        try {
          const referrer = await this.getKnowledge(inEdge.targetId);
          if (referrer) {
            const updatedEdges = (referrer.edges || []).map((e: GraphEdge) =>
              e.targetId === sourceId ? { ...e, targetId } : e
            );
            await this.updateKnowledge(inEdge.targetId, { edges: updatedEdges });
          }
    } catch {
      // Ignore
    }
      }
    }

    await this.updateKnowledge(targetId, {
      content: mergedContent,
      tags: mergedTags,
      edges: cleanedEdges,
      confidence: mergedConfidence,
      metadata: {
        ...(target.metadata as Record<string, unknown>),
        ...(source.metadata as Record<string, unknown>),
        mergedFrom: sourceId,
      },
    });

    await this.deleteKnowledge(sourceId);
  }

  async updateKnowledge(kbId: string, patch: Partial<KnowledgeBaseItem>): Promise<void> {
    const existing = await this.getKnowledge(kbId);
    const dbUpdates: Record<string, unknown> = {};

    if (patch.content !== undefined) dbUpdates.content = patch.content;
    if (patch.tags !== undefined) dbUpdates.tags = JSON.stringify(patch.tags);
    if (patch.embedding !== undefined) dbUpdates.embedding = JSON.stringify(patch.embedding);
    if (patch.confidence !== undefined) dbUpdates.confidence = patch.confidence;
    if (patch.metadata !== undefined)
      dbUpdates.metadata = JSON.stringify({ ...existing.metadata, ...patch.metadata });

    if (patch.edges !== undefined) {
      await this._removeOutboundEdges(kbId, existing.edges || []);
      await this.ctx.push({
        type: 'delete',
        table: 'knowledge_edges',
        where: [{ column: 'sourceId', value: kbId }],
        layer: 'domain',
      } as WriteOp);

      for (const edge of patch.edges) {
        await this.ctx.push({
          type: 'insert',
          table: 'knowledge_edges',
          values: {
            sourceId: kbId,
            targetId: edge.targetId,
            type: edge.type,
            weight: edge.weight ?? 1.0,
          },
          layer: 'domain',
        } as WriteOp);
      }
      await this._syncOutboundEdges(kbId, patch.edges);
    }

    await this.ctx.push({
      type: 'update',
      table: 'knowledge',
      values: dbUpdates,
      where: [
        { column: 'id', value: kbId },
        { column: 'userId', value: this.ctx.userId },
      ],
      layer: 'domain',
    } as WriteOp);

    if (this.ctx.kbCache.has(kbId)) {
      this.ctx.kbCache.set(kbId, { ...existing, ...patch });
    }
  }

  async deleteKnowledge(kbId: string): Promise<void> {
    const item = await this.getKnowledge(kbId);
    await this._removeOutboundEdges(kbId, item.edges || []);

    await this.ctx.push({
      type: 'delete',
      table: 'knowledge',
      where: [
        { column: 'id', value: kbId },
        { column: 'userId', value: this.ctx.userId },
      ],
      layer: 'domain',
    } as WriteOp);

    this.ctx.kbCache.delete(kbId);
  }

  async getKnowledge(itemId: string): Promise<KnowledgeBaseItem> {
    const batch = await this.getKnowledgeBatch([itemId]);
    if (batch.length === 0)
      throw new AgentGitError(`Knowledge ${itemId} not found`, 'NODE_NOT_FOUND');
    return batch[0]!;
  }

  async getKnowledgeBatch(itemIds: string[]): Promise<KnowledgeBaseItem[]> {
    if (itemIds.length === 0) return [];

    const results: KnowledgeBaseItem[] = [];
    const missingIds: string[] = [];

    for (const id of itemIds) {
      const cached = this.ctx.kbCache.get(id);
      if (cached) results.push(cached);
      else missingIds.push(id);
    }

    if (missingIds.length > 0) {
      const rows = await this.ctx.db.selectWhere('knowledge', [
        { column: 'id', value: missingIds, operator: 'IN' },
        { column: 'userId', value: this.ctx.userId },
      ]);

      if (rows.length > 0) {
        const foundIds = rows.map((r) => r.id as string);

        const [outboundRows, inboundRows] = await Promise.all([
          this.ctx.db.selectWhere('knowledge_edges', [
            { column: 'sourceId', value: foundIds, operator: 'IN' },
          ]),
          this.ctx.db.selectWhere('knowledge_edges', [
            { column: 'targetId', value: foundIds, operator: 'IN' },
          ]),
        ]);

        for (const row of rows) {
          const kbId = row.id as string;
          const nodeData: KnowledgeBaseItem = {
            itemId: row.id as string,
            type: row.type as KnowledgeBaseItem['type'],
            content: row.content as string,
            tags: JSON.parse((row.tags as string) || '[]'),
            edges: outboundRows
              .filter((r) => r.sourceId === kbId)
              .map((r) => ({
                targetId: r.targetId as string,
                type: r.type as GraphEdge['type'],
                weight: r.weight as number,
              })),
            inboundEdges: inboundRows
              .filter((r) => r.targetId === kbId)
              .map((r) => ({
                targetId: r.sourceId as string,
                type: r.type as GraphEdge['type'],
                weight: r.weight as number,
              })),
            embedding: row.embedding ? JSON.parse(row.embedding as string) : undefined,
            confidence: row.confidence as number,
            hubScore: row.hubScore as number,
            metadata: JSON.parse((row.metadata as string) || '{}'),
            createdAt: Number(row.createdAt),
          };

          // Unified CAS Hydration
          if (nodeData.content.startsWith('CAS:')) {
              const hash = nodeData.content.substring(4);
              const hydrated = await this.ctx.storage.readBlob(hash);
              if (hydrated) {
                  nodeData.content = hydrated.toString('utf8');
              } else {
                  nodeData.content = `[UNHYDRATED_CAS_NODE:${hash}]`;
              }
          }

          this.ctx.kbCache.set(kbId, nodeData);
          results.push(nodeData);
        }
      }
    }

    return results;
  }

  async traverseGraph(
    startId: string,
    maxDepth = 2,
    filter?: TraversalFilter
  ): Promise<KnowledgeBaseItem[]> {
    const visited = new Set<string>();
    const results: KnowledgeBaseItem[] = [];
    const direction = filter?.direction || 'outbound';

    let currentLevelIds = [startId];
    for (let depth = 0; depth <= maxDepth; depth++) {
      if (currentLevelIds.length === 0) break;
      const nextLevelIds = new Set<string>();
      const idsToFetch = currentLevelIds.filter((id) => !visited.has(id));

      const nodes = await this.getKnowledgeBatch(idsToFetch);
      for (const node of nodes) {
        visited.add(node.itemId);
        results.push(node);

        if (depth < maxDepth) {
          let edges = direction === 'inbound' ? node.inboundEdges : node.edges;
          if (direction === 'both') edges = [...(node.edges || []), ...(node.inboundEdges || [])];

          if (filter?.edgeTypes) edges = edges.filter((e) => filter.edgeTypes?.includes(e.type));
          if (filter?.minWeight)
            edges = edges.filter((e) => (e.weight ?? 1.0) >= filter.minWeight!);

          for (const e of edges) {
            if (!visited.has(e.targetId)) nextLevelIds.add(e.targetId);
          }
        }
      }
      currentLevelIds = Array.from(nextLevelIds);
    }

    return results;
  }

  async getNodeCentrality(
    kbId: string
  ): Promise<{ kbId: string; inbound: number; outbound: number; totalDegree: number }> {
    const node = await this.getKnowledge(kbId);
    const inbound = (node.inboundEdges || []).length;
    const outbound = (node.edges || []).length;
    return { kbId, inbound, outbound, totalDegree: inbound + outbound };
  }

  private async _syncOutboundEdges(_sourceId: string, edges: GraphEdge[]): Promise<void> {
    for (const edge of edges) {
      await this.ctx.push({
        type: 'update',
        table: 'knowledge',
        values: { hubScore: 1 }, // Simple increment logic handled in orchestration if needed
        where: [{ column: 'id', value: edge.targetId }],
        layer: 'domain',
      } as WriteOp);
    }
  }

  private async _removeOutboundEdges(_sourceId: string, edges: GraphEdge[]): Promise<void> {
    for (const edge of edges) {
      await this.ctx.push({
        type: 'update',
        table: 'knowledge',
        values: { hubScore: -1 },
        where: [{ column: 'id', value: edge.targetId }],
        layer: 'domain',
      } as WriteOp);
    }
  }

  async extractSubgraph(
    rootId: string,
    maxDepth = 2,
    filter?: TraversalFilter
  ): Promise<{
    nodes: KnowledgeBaseItem[];
    edges: { sourceId: string; targetId: string; type: string; weight?: number }[];
  }> {
    const nodes = await this.traverseGraph(rootId, maxDepth, filter);
    const nodeIds = new Set(nodes.map((n) => n.itemId));
    const edges: { sourceId: string; targetId: string; type: string; weight?: number }[] = [];

    for (const node of nodes) {
      for (const edge of node.edges || []) {
        if (nodeIds.has(edge.targetId)) {
          edges.push({
            sourceId: node.itemId,
            targetId: edge.targetId,
            type: edge.type,
            weight: edge.weight ?? 1.0,
          });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Generates a compact text-based representation of a subgraph to "seed" a worker's context.
   * Absorbed from src/utils/promptCategory.ts.
   */
  async getWorkerContext(rootId: string, maxDepth = 2): Promise<string> {
    const subgraph = await this.extractSubgraph(rootId, maxDepth);
    if (subgraph.nodes.length === 0) return '';

    let context = '<knowledge-graph-context>\n';
    for (const node of subgraph.nodes) {
      context += `[Node: ${node.itemId}] (${node.type}) ${node.content.substring(0, 500)}${
        node.content.length > 500 ? '...' : ''
      }\n`;
      const edges = node.edges || [];
      if (edges.length > 0) {
        context += `  Edges: ${edges.map((e) => `-> ${e.targetId} (${e.type})`).join(', ')}\n`;
      }
    }
    context += '</knowledge-graph-context>';
    return context;
  }
}
