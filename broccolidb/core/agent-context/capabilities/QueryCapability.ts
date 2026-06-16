// [LAYER: CORE]
// @classification CAPABILITY
import type { BufferedDbPool, WriteOp } from '../../../infrastructure/db/BufferedDbPool.js';
import type { GraphService } from '../GraphService.js';
import type { ReasoningService } from '../ReasoningService.js';
import type {
  AgentBundle,
  AgentProfile,
  KnowledgeBaseItem,
  TraversalFilter,
} from '../types.js';
import type { Workspace } from '../../workspace.js';

export class QueryCapability {
  constructor(
    private readonly db: BufferedDbPool,
    private readonly graphService: GraphService,
    private readonly reasoningService: ReasoningService,
    private readonly workspace: Workspace,
    private readonly userId: string,
    private readonly push: (op: WriteOp, agentId?: string) => Promise<void>,
    private readonly assertOperational: (operation: string) => void
  ) {}

  async searchKnowledge(
    query: string,
    tags?: string[],
    limit = 20,
    _queryEmbedding?: number[],
    options: { augmentWithGraph?: boolean; skipVerification?: boolean } = {}
  ): Promise<KnowledgeBaseItem[]> {
    this.assertOperational('searchKnowledge');
    const results = await this.graphService.traverseGraph('HEAD', limit, {
      direction: 'both',
      minWeight: 0.1,
    });

    let filtered = results.filter((r) =>
      (r.content || '').toLowerCase().includes(query.toLowerCase())
    );
    if (tags && tags.length > 0) {
      filtered = filtered.filter((r) => tags.every((t) => (r.tags || []).includes(t)));
    }

    if (!options.skipVerification) {
      const verification = await this.verifyKnowledgeBatch(filtered.map((f) => f.itemId));
      filtered = filtered.sort((a, b) => {
        const confA = verification.get(a.itemId)?.confidence ?? 0;
        const confB = verification.get(b.itemId)?.confidence ?? 0;
        return confB - confA;
      });
    }

    return filtered.slice(0, limit);
  }

  async verifyKnowledgeBatch(
    itemIds: string[]
  ): Promise<Map<string, { isValid: boolean; confidence: number }>> {
    this.assertOperational('verifyKnowledgeBatch');
    const results = new Map<string, { isValid: boolean; confidence: number }>();
    for (const id of itemIds) {
      const { isValid, metrics } = await this.reasoningService.verifySovereignty(id);
      results.set(id, {
        isValid,
        confidence: (metrics?.finalProb as number) ?? 0.5,
      });
    }
    return results;
  }

  async getGlobalCentrality(limit?: number) {
    this.assertOperational('getGlobalCentrality');
    const rows = await this.db.selectWhere(
      'knowledge',
      [{ column: 'userId', value: this.userId }],
      undefined,
      {
        orderBy: { column: 'hubScore', direction: 'desc' },
        limit: limit ?? 10,
      }
    );
    return rows.map((r) => ({ kbId: r.id as string, score: (r.hubScore as number) || 0 }));
  }

  async appendSharedMemory(memory: string): Promise<void> {
    this.assertOperational('appendSharedMemory');
    const ws = await this.db.selectOne('workspaces', [
      { column: 'id', value: this.workspace.workspaceId },
    ]);
    const current = JSON.parse(ws?.sharedMemoryLayer || '[]');
    current.push(memory);
    await this.push({
      type: 'update',
      table: 'workspaces',
      where: [{ column: 'id', value: this.workspace.workspaceId }],
      values: { sharedMemoryLayer: JSON.stringify(current) },
      layer: 'domain',
    });
  }

  async decayConfidence(factor: number, olderThan: number | Date) {
    this.assertOperational('decayConfidence');
    const threshold = olderThan instanceof Date ? olderThan.getTime() : olderThan;
    const rows = await this.db.selectWhere('agent_knowledge' as any, [
      { column: 'userId', value: this.userId },
      { column: 'createdAt', value: threshold, operator: '<' },
    ]);
    for (const row of rows) {
      const current = (row.confidence as number) ?? 1.0;
      await this.push({
        type: 'update',
        table: 'agent_knowledge' as any,
        where: [{ column: 'id', value: row.id }],
        values: { confidence: Math.max(0, current * factor) },
        layer: 'infrastructure',
      });
    }
    return { decayedCount: rows.length };
  }

  async getAgentBundle(agentId: string): Promise<AgentBundle> {
    this.assertOperational('getAgentBundle');
    const profile = await this.getAgentProfile(agentId);
    const tasks = await this.db.selectWhere('agent_tasks' as any, [
      { column: 'agentId', value: agentId },
      { column: 'status', value: ['pending', 'active'], operator: 'IN' },
    ]);

    const results = await this.db.selectWhere('agent_knowledge' as any, [
      { column: 'userId', value: this.userId },
    ]);
    const recentKnowledge = results.map((r: any) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    })) as KnowledgeBaseItem[];

    return {
      profile,
      activeTasks: tasks.map((t) => ({ ...t, taskId: t.id }) as any),
      recentKnowledge,
    };
  }

  async getTaskById(taskId: string): Promise<any> {
    this.assertOperational('getTaskById');
    const tResults = await this.db.selectWhere('agent_tasks' as any, [
      { column: 'id', value: taskId },
    ]);
    return tResults.length > 0 ? tResults[0] : null;
  }

  private async getAgentProfile(agentId: string): Promise<AgentProfile> {
    const results = await this.db.selectWhere('agent_streams' as any, [{ column: 'id', value: agentId }]);
    const row = results.length > 0 ? results[0] : ({ id: agentId, status: 'active' } as any);
    return {
      agentId: row.id,
      name: row.externalId || row.id,
      role: 'swarm-agent',
      status: row.status as any,
      permissions: [],
      createdAt: row.createdAt || Date.now(),
      lastActive: Date.now(),
    };
  }
}
