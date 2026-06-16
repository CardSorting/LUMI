// [LAYER: CORE]
// @classification CAPABILITY
import type { BufferedDbPool, WriteOp } from '../../../infrastructure/db/BufferedDbPool.js';
import type { GraphService } from '../GraphService.js';
import type { ReasoningService } from '../ReasoningService.js';
import type { AgentProfile, KnowledgeBaseItem, ServiceContext, ToolDef } from '../types.js';
import type { Workspace } from '../../workspace.js';
import {
  StreamingToolExecutor,
  type ToolCall,
  type ToolExecutorOptions,
  type ToolResult,
} from '../StreamingToolExecutor.js';
import { AgentGitError } from '../../errors.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
import {
  requireNonEmptyString,
  requirePositiveInt,
  type QueryAgentBundleInput,
  type QueryAgentBundleResult,
  type QueryAppendSharedMemoryInput,
  type QueryAppendSharedMemoryResult,
  type QueryDecayConfidenceInput,
  type QueryDecayConfidenceResult,
  type QueryErgonomicsSnapshotResult,
  type QueryExecuteToolsInput,
  type QueryExecuteToolsResult,
  type QueryGlobalCentralityInput,
  type QueryGlobalCentralityResult,
  type QueryReembedResult,
  type QuerySearchInput,
  type QuerySearchResult,
  type QueryTaskLookupInput,
  type QueryTaskLookupResult,
  type QueryVerifyBatchInput,
  type QueryVerifyBatchResult,
} from '../capability-types.js';

type AgentKnowledgeRow = {
  id: string;
  metadata?: string | null;
  confidence?: number | null;
  userId?: string;
  createdAt?: number | null;
};

export class QueryCapability extends CapabilityBase {
  readonly name = 'query' as const;
  readonly dependencies = ['GraphService', 'ReasoningService', 'BufferedDbPool'] as const;

  constructor(
    private readonly db: BufferedDbPool,
    private readonly graphService: GraphService,
    private readonly reasoningService: ReasoningService,
    private readonly workspace: Workspace,
    private readonly userId: string,
    private readonly push: (op: WriteOp, agentId?: string) => Promise<void>,
    private readonly serviceContext: ServiceContext,
    private readonly getCacheStats: () => { hits: number; misses: number; size: number },
    private readonly getTeammates: () => string[],
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async search(input: QuerySearchInput): Promise<QuerySearchResult> {
    return this.execute(
      'search',
      async () => {
      const text = requireNonEmptyString(input.text, 'text');
      const limit = requirePositiveInt(input.limit, 'limit', 20);
      const results = await this.graphService.traverseGraph('HEAD', limit, {
        direction: 'both',
        minWeight: 0.1,
      });

      let filtered = results.filter((r) =>
        (r.content || '').toLowerCase().includes(text.toLowerCase())
      );
      if (input.tags && input.tags.length > 0) {
        filtered = filtered.filter((r) => input.tags!.every((t) => (r.tags || []).includes(t)));
      }

      if (!input.skipVerification) {
        const verification = await this.verifyBatch({ itemIds: filtered.map((f) => f.itemId) });
        filtered = filtered.sort((a, b) => {
          const confA = verification.results[a.itemId]?.confidence ?? 0;
          const confB = verification.results[b.itemId]?.confidence ?? 0;
          return confB - confA;
        });
      }

      const items = filtered.slice(0, limit);
      return { items, total: items.length };
      },
      {
        input,
        inputSummary: { textLength: input.text.length, limit: input.limit ?? 20, tagCount: input.tags?.length ?? 0 },
        expectedEffects: ['GraphService.traverseGraph', 'ReasoningService.verifySovereignty'],
        summarizeResult: (result) => ({ total: result.total }),
      }
    );
  }

  async verifyBatch(input: QueryVerifyBatchInput): Promise<QueryVerifyBatchResult> {
    return this.execute('verifyBatch', async () => {
      if (!Array.isArray(input.itemIds)) {
        throw new AgentGitError('itemIds must be an array', 'INVALID_ARGUMENT');
      }
      const results: Record<string, { isValid: boolean; confidence: number }> = {};
      for (const id of input.itemIds) {
        const { isValid, metrics } = await this.reasoningService.verifySovereignty(id);
        const finalProb = metrics?.finalProb;
        results[id] = {
          isValid,
          confidence: typeof finalProb === 'number' ? finalProb : 0.5,
        };
      }
      return { results };
    });
  }

  async getGlobalCentrality(input: QueryGlobalCentralityInput = {}): Promise<QueryGlobalCentralityResult> {
    return this.execute('getGlobalCentrality', async () => {
      const limit = requirePositiveInt(input.limit, 'limit', 10);
      const rows = await this.db.selectWhere(
        'knowledge',
        [{ column: 'userId', value: this.userId }],
        undefined,
        {
          orderBy: { column: 'hubScore', direction: 'desc' },
          limit,
        }
      );
      return {
        hubs: rows.map((r) => ({ kbId: String(r.id), score: Number(r.hubScore) || 0 })),
      };
    });
  }

  async appendSharedMemory(input: QueryAppendSharedMemoryInput): Promise<QueryAppendSharedMemoryResult> {
    return this.execute('appendSharedMemory', async () => {
      const memory = requireNonEmptyString(input.memory, 'memory');
      const ws = await this.db.selectOne('workspaces', [
        { column: 'id', value: this.workspace.workspaceId },
      ]);
      const current = JSON.parse(String(ws?.sharedMemoryLayer || '[]')) as string[];
      current.push(memory);
      await this.push({
        type: 'update',
        table: 'workspaces',
        where: [{ column: 'id', value: this.workspace.workspaceId }],
        values: { sharedMemoryLayer: JSON.stringify(current) },
        layer: 'domain',
      });
      return { appended: true };
    });
  }

  async decayConfidence(input: QueryDecayConfidenceInput): Promise<QueryDecayConfidenceResult> {
    return this.execute('decayConfidence', async () => {
      if (!Number.isFinite(input.factor) || input.factor < 0 || input.factor > 1) {
        throw new AgentGitError('factor must be between 0 and 1', 'INVALID_ARGUMENT');
      }
      const threshold = input.olderThan instanceof Date ? input.olderThan.getTime() : input.olderThan;
      const rows = await this.db.selectWhere('agent_knowledge' as 'knowledge', [
        { column: 'userId', value: this.userId },
        { column: 'createdAt', value: threshold, operator: '<' },
      ]);
      for (const row of rows) {
        const current = Number(row.confidence) || 1.0;
        await this.push({
          type: 'update',
          table: 'agent_knowledge' as 'knowledge',
          where: [{ column: 'id', value: row.id }],
          values: { confidence: Math.max(0, current * input.factor) },
          layer: 'infrastructure',
        });
      }
      return { decayedCount: rows.length };
    });
  }

  async getAgentBundle(input: QueryAgentBundleInput): Promise<QueryAgentBundleResult> {
    return this.execute('getAgentBundle', async () => {
      const agentId = requireNonEmptyString(input.agentId, 'agentId');
      const profile = await this.getAgentProfile(agentId);
      const tasks = await this.db.selectWhere('agent_tasks' as 'tasks', [
        { column: 'agentId', value: agentId },
        { column: 'status', value: ['pending', 'active'], operator: 'IN' },
      ]);

      const results = await this.db.selectWhere('agent_knowledge' as 'knowledge', [
        { column: 'userId', value: this.userId },
      ]);
      const recentKnowledge = results.map((r) => this.toKnowledgeItem(r as AgentKnowledgeRow));

      return {
        bundle: {
          profile,
          activeTasks: tasks.map((t) => ({
            taskId: String(t.id),
            agentId: String(t.agentId),
            status: t.status as QueryAgentBundleResult['bundle']['activeTasks'][number]['status'],
            description: String(t.description),
            createdAt: Number(t.createdAt),
            updatedAt: Number(t.updatedAt),
          })),
          recentKnowledge,
        },
      };
    });
  }

  async getTaskById(input: QueryTaskLookupInput): Promise<QueryTaskLookupResult> {
    return this.execute('getTaskById', async () => {
      const taskId = requireNonEmptyString(input.taskId, 'taskId');
      const tResults = await this.db.selectWhere('agent_tasks' as 'tasks', [
        { column: 'id', value: taskId },
      ]);
      const row = tResults[0];
      return { task: row ? (Object.fromEntries(Object.entries(row)) as Record<string, unknown>) : null };
    });
  }

  createToolExecutor(tools: ToolDef[], options: ToolExecutorOptions = {}): StreamingToolExecutor {
    return this.run('createToolExecutor', () => new StreamingToolExecutor(tools, this.serviceContext, options));
  }

  async executeTools(input: QueryExecuteToolsInput): Promise<QueryExecuteToolsResult> {
    return this.execute('executeTools', async () => {
      const executor = this.createToolExecutor(input.tools, input.options);
      const results: ToolResult[] = [];
      for await (const result of executor.executeBatch(input.calls)) {
        results.push(result);
      }
      return { results };
    });
  }

  async reembedAll(): Promise<QueryReembedResult> {
    return this.execute('reembedAll', async () => ({ embeddedCount: 0, skippedCount: 0 }));
  }

  getErgonomicsSnapshot(): QueryErgonomicsSnapshotResult {
    return this.run('getErgonomicsSnapshot', () => ({
      userId: this.userId,
      workspaceId: this.workspace.workspaceId,
      workspacePath: this.workspace.workspacePath,
      teammates: this.getTeammates(),
      cache: this.getCacheStats(),
      capabilities: [
        'storage',
        'telemetry',
        'recovery',
        'audit',
        'coordination',
        'query',
        'snapshots',
        'graph',
        'reasoning',
        'tasks',
        'scratchpad',
        'mailbox',
      ],
      toolExecutionDefaults: {
        timeoutMs: 60000,
        maxParallelReads: 8,
        mirrorFileChanges: true,
        failOnUnsafeMutationPath: true,
        forensicPreEditGate: true,
        failOnPreEditBlockers: false,
        failOnPostEditBlockers: false,
        recordAuditEvents: true,
      },
    }));
  }

  private async getAgentProfile(agentId: string): Promise<AgentProfile> {
    const results = await this.db.selectWhere('agent_streams' as 'agent_streams', [
      { column: 'id', value: agentId },
    ]);
    const row = results[0] ?? { id: agentId, status: 'active' };
    return {
      agentId: String(row.id),
      name: String(row.externalId || row.id),
      role: 'swarm-agent',
      status: (row.status as AgentProfile['status']) || 'active',
      permissions: [],
      createdAt: Number(row.createdAt) || Date.now(),
      lastActive: Date.now(),
    };
  }

  private toKnowledgeItem(row: AgentKnowledgeRow): KnowledgeBaseItem {
    return {
      ...(row as unknown as KnowledgeBaseItem),
      itemId: String(row.id),
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    } as KnowledgeBaseItem;
  }
}
