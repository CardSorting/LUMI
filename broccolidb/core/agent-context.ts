import { AuditService } from './agent-context/AuditService.js';
import { CleanupService } from './agent-context/CleanupService.js';
import { DiagnosisService } from './agent-context/DiagnosisService.js';
import { GraphService } from './agent-context/GraphService.js';
import { LspService } from './agent-context/LspService.js';
import { MailboxService } from './agent-context/MailboxService.js';
import { MutexService } from './agent-context/MutexService.js';
import { PasteStore } from './agent-context/PasteStore.js';
import { ReasoningService } from './agent-context/ReasoningService.js';
import { SideQueryService } from './agent-context/SideQueryService.js';
import { SpiderService } from './agent-context/SpiderService.js';
import { TaskService } from './agent-context/TaskService.js';
import { BufferedDbPool, type WriteOp } from '../infrastructure/db/BufferedDbPool.js';

export type {
  AgentBundle,
  AgentProfile,
  ImpactReport,
  KnowledgeBaseItem,
  Pedigree,
  ServiceContext,
  TraversalFilter,
} from './agent-context/types.js';

import type {
  AgentBundle,
  AgentProfile,
  ImpactReport,
  KnowledgeBaseItem,
  Pedigree,
  ServiceContext,
  TraversalFilter,
} from './agent-context/types.js';
import { LRUCache } from './lru-cache.js';
import type { Workspace } from './workspace.js';

/**
 * AgentContext provides a unified entry point for BroccoliDB's epistemic
 * and task-related operations. It coordinates specialized services for
 * graph management, reasoning, auditing, and structural discovery.
 */
export class AgentContext {
  private readonly _db: BufferedDbPool;
  private readonly _kbCache: LRUCache<string, KnowledgeBaseItem>;
  private readonly _serviceContext: ServiceContext;

  private readonly _graphService: GraphService;
  private readonly _reasoningService: ReasoningService;
  private readonly _taskService: TaskService;
  private readonly _auditService: AuditService;
  private readonly _spiderService: SpiderService;
  private readonly _diagnosisService: DiagnosisService;
  private readonly _mailboxService: MailboxService;
  private readonly _pasteStore: PasteStore;
  private readonly _sideQueryService: SideQueryService;
  private readonly _mutexService: MutexService;
  private readonly _cleanupService: CleanupService;
  private readonly _lspService: LspService;
  private readonly _teammates: Set<string> = new Set();

  public readonly userId: string;

  constructor(
    workspace: Workspace,
    db?: BufferedDbPool,
    userId?: string,
    _profile?: { agentId: string; name: string }
  ) {
    this._db = db || workspace.getDb();
    this.userId = (userId || workspace.userId).trim();
    this._kbCache = new LRUCache<string, KnowledgeBaseItem>(2000);

    this._serviceContext = {
      db: this._db,
      aiService: (workspace as any).aiService || null,
      kbCache: this._kbCache,
      workspace: workspace,
      userId: this.userId,
      push: this._push.bind(this),
      pushBatch: (ops: WriteOp[]) => this._pushBatch(ops),
      searchKnowledge: this.searchKnowledge.bind(this),
      updateTaskStatus: this.updateTaskStatus.bind(this),
      getStructuralImpact: (p: string) => this.getStructuralImpact(p) as any,
      pasteStore: undefined as any, // Bootstrapped below
      lsp: undefined as any, // Bootstrapped below
    };

    this._graphService = new GraphService(this._serviceContext);
    this._taskService = new TaskService(this._serviceContext, this._graphService);
    this._reasoningService = new ReasoningService(this._serviceContext, this._graphService);
    this._auditService = new AuditService(
      this._serviceContext,
      this._graphService,
      this._reasoningService
    );
    this._spiderService = new SpiderService(this._serviceContext);
    this._diagnosisService = new DiagnosisService(this._serviceContext, this._graphService, this._reasoningService);
    this._mailboxService = new MailboxService(this._serviceContext);
    this._pasteStore = new PasteStore(this._serviceContext);
    this._sideQueryService = new SideQueryService(this._serviceContext);
    this._mutexService = new MutexService(this._serviceContext);
    this._cleanupService = new CleanupService(this._serviceContext, this._taskService, this._reasoningService);
    this._lspService = new LspService(this._serviceContext);

    // Final bootstrap
    (this._serviceContext as any).pasteStore = this._pasteStore;
    (this._serviceContext as any).lsp = this._lspService;
  }

  /**
   * Overrides the mailbox with a shared instance for swarm coordination.
   */
  public setSharedMailbox(mailbox: MailboxService) {
    (this as any)._mailboxService = mailbox;
  }

  public get db() {
    return this._db;
  }
  public get graphService() {
    return this._graphService;
  }
  public get reasoningService() {
    return this._reasoningService;
  }
  public get taskService() {
    return this._taskService;
  }
  public get diagnosisService() {
    return this._diagnosisService;
  }
  public get mailbox() {
    return this._mailboxService;
  }
  public get audit() {
    return this._auditService;
  }
  public get sideQuery() {
    return this._sideQueryService;
  }
  public get cleanup() {
    return this._cleanupService;
  }
  public get lsp() {
    return this._lspService;
  }
  public get spider() {
    return this._spiderService;
  }
  public get mutex() {
    return this._mutexService;
  }
  public get pasteStore() {
    return this._pasteStore;
  }
  public get graph() {
    return this._graphService;
  }
  public get tasks() {
    return this._taskService;
  }

  /**
   * Registers a sibling agent that shares the same workspace and memory space.
   * Absorbed from src/utils/swarm/inProcessRunner.ts.
   */
  public registerTeammate(agentId: string) {
    this._teammates.add(agentId);
    console.log(`[AgentContext] Teammate registered: ${agentId}`);
  }

  /**
   * Epistemic Retraction (Sovereign Undo).
   * Absorbed from src/history.ts (removeLastFromHistory).
   */
  public async retractLastOperation() {
      console.log(`[AgentContext] ↩️ Retracting last operation for user ${this.userId}...`);
      // Rolls back the most recent uncommitted shadow write for this agent.
      await this._db.rollbackWork(this.userId);
      
      // Also invalidate the last added KB item in cache
      this._kbCache.clear(); // Safe but expensive; in practice we'd target the last ID.
  }

  public getTeammates(): string[] {
    return Array.from(this._teammates);
  }

  private async _push(op: WriteOp, agentId?: string) {
    await this._db.push(op, agentId);
  }

  private async _pushBatch(ops: WriteOp[], agentId?: string) {
    await this._db.pushBatch(ops, agentId);
  }

  async flush(): Promise<void> {
    return this._db.flush();
  }

  // ─── AGENT MANAGEMENT BRIDGES ───
  async registerAgent(agentId: string, name: string, role: string, permissions: string[] = []) {
    return this._taskService.registerAgent(agentId, name, role, permissions);
  }
  async getAgent(agentId: string) {
    return this._taskService.getAgent(agentId);
  }
  async appendMemoryLayer(agentId: string, memory: string) {
    return this._taskService.appendMemoryLayer(agentId, memory);
  }

  async annotateKnowledge(
    targetId: string,
    annotation: string,
    agentId?: string,
    metadata: Record<string, any> = {}
  ) {
    const targetNode = await this.getKnowledge(targetId);
    const edges = [...(targetNode.edges || [])];

    const annotationId = await this.addKnowledge(
      `note-${crypto.randomUUID()}`,
      'fact',
      annotation,
      {
        tags: ['annotation'],
        metadata: { ...metadata, targetId, agentId },
      }
    );

    edges.push({ targetId: annotationId, type: 'references' });
    await this.updateKnowledge(targetId, { edges });
  }

  // ─── KNOWLEDGE BASE BRIDGES ───
  async addKnowledge(
    kbId: string,
    type: KnowledgeBaseItem['type'],
    content: string,
    options: {
      tags?: string[];
      edges?: any[];
      embedding?: number[];
      confidence?: number;
      expiresAt?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    return this._graphService.addKnowledge(kbId, type, content, options);
  }
  async updateKnowledge(kbId: string, patch: Partial<KnowledgeBaseItem>) {
    return this._graphService.updateKnowledge(kbId, patch);
  }
  async deleteKnowledge(kbId: string) {
    return this._graphService.deleteKnowledge(kbId);
  }
  async mergeKnowledge(sourceId: string, targetId: string) {
    return this._graphService.mergeKnowledge(sourceId, targetId);
  }
  async getKnowledge(itemId: string) {
    return this._graphService.getKnowledge(itemId);
  }
  async getKnowledgeBatch(ids: string[]) {
    return this._graphService.getKnowledgeBatch(ids);
  }
  async traverseGraph(startId: string, maxDepth = 2, filter?: TraversalFilter) {
    return this._graphService.traverseGraph(startId, maxDepth, filter);
  }

  // ─── REASONING BRIDGES ───
  async detectContradictions(startIds: string | string[], depth?: number) {
    return this._reasoningService.detectContradictions(startIds, depth);
  }
  async getReasoningPedigree(nodeId: string, maxDepth?: number): Promise<Pedigree> {
    return this._reasoningService.getReasoningPedigree(nodeId, maxDepth);
  }
  async getNarrativePedigree(nodeId: string) {
    return this._reasoningService.getNarrativePedigree(nodeId);
  }
  async verifySovereignty(nodeId: string) {
    return this._reasoningService.verifySovereignty(nodeId);
  }
  async autoDiscoverRelationships(nodeId: string, limit?: number) {
    return this._reasoningService.autoDiscoverRelationships(nodeId, limit);
  }

  async updateTaskStatus(taskId: string, status: any, result?: any) {
    return this._taskService.updateTaskStatus(taskId, status, result);
  }
  async getLogicalSoundness(nodeIds: string[]) {
    return this._reasoningService.getLogicalSoundness(nodeIds);
  }

  // ─── AUDIT BRIDGES ───
  async speculateImpact(content: string, _startId?: string): Promise<ImpactReport> {
    return this._auditService.predictEffect(content);
  }
  async addLogicalConstraint(
    pathPattern: string,
    knowledgeId: string,
    severity: 'blocking' | 'warning' = 'blocking'
  ) {
    return this._auditService.addLogicalConstraint(pathPattern, knowledgeId, severity);
  }
  async getLogicalConstraints() {
    return this._auditService.getLogicalConstraints();
  }
  async checkConstitutionalViolation(path: string, code: string, ruleContent: string) {
    return this._auditService.checkConstitutionalViolation(path, code, ruleContent);
  }

  // ─── SPIDER BRIDGES (STRUCTURAL IMPACT) ───
  getStructuralImpact(filePath: string) {
    const discovery = this._spiderService.getDiscovery();
    return {
      summary: discovery.getImportanceSummary(filePath),
      blastRadius: discovery.getBlastRadius(filePath),
    };
  }

  /**
   * CCR (Cross-Conversation Resume).
   * Fast-forwards graph state from history snapshots. 
   * Captured from src/utils/ultraplan/ccrSession.ts.
   */
  async reconstituteFromDigest(digest: string): Promise<void> {
    const data = JSON.parse(digest);
    if (!data.knowledgeIds || !Array.isArray(data.knowledgeIds)) {
        return;
    }

    console.log(`[AgentContext] CCR: Reconstituting ${data.knowledgeIds.length} items from historic digest.`);

    for (const id of data.knowledgeIds) {
        // Hydrate from disk to RAM hot-layer
        await this._graphService.getKnowledge(id).catch(() => null);
    }
  }

  // ─── TASK & MEMORY BRIDGES ───
  async spawnTask(
    taskId: string,
    agentId: string,
    description: string,
    linkedKnowledgeIds?: string[]
  ) {
    return this._taskService.spawnTask(taskId, agentId, description, linkedKnowledgeIds);
  }
  async getTaskContext(taskId: string) {
    return this._taskService.getTaskContext(taskId);
  }
  async appendSharedMemory(memory: string) {
    const ws = await this._db.selectOne('workspaces', [
      { column: 'id', value: this._serviceContext.workspace.workspaceId },
    ]);
    const current = JSON.parse(ws?.sharedMemoryLayer || '[]');
    current.push(memory);
    await this._push({
      type: 'update',
      table: 'workspaces',
      where: [{ column: 'id', value: this._serviceContext.workspace.workspaceId }],
      values: { sharedMemoryLayer: JSON.stringify(current) },
      layer: 'domain',
    });
  }

  // ─── ANALYTICS BRIDGES ───
  async getNodeCentrality(kbId: string) {
    return this._graphService.getNodeCentrality(kbId);
  }
  async getGlobalCentrality(limit?: number) {
    const rows = await this._db.selectWhere(
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
  async extractSubgraph(rootId: string, maxDepth = 2, filter?: TraversalFilter) {
    return this._graphService.extractSubgraph(rootId, maxDepth, filter);
  }

  // ─── SEARCH & VERIFICATION ───
  public async verifyKnowledgeBatch(
    itemIds: string[]
  ): Promise<Map<string, { isValid: boolean; confidence: number }>> {
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

  async searchKnowledge(
    query: string,
    tags?: string[],
    limit = 20,
    _queryEmbedding?: number[],
    options: { augmentWithGraph?: boolean; skipVerification?: boolean } = {}
  ): Promise<KnowledgeBaseItem[]> {
    const results = await this._graphService.traverseGraph('HEAD', limit, {
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

  // ─── SYSTEM BRIDGES ───
  async selfHealGraph() {
    return this._reasoningService.selfHealGraph(async () => {
      const results = await this._db.selectWhere('agent_knowledge' as any, [
        { column: 'userId', value: this.userId },
      ]);
      return results.map((r: any) => ({
        ...r,
        itemId: r.id,
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
      })) as KnowledgeBaseItem[];
    });
  }

  async performMemorySynthesis() {
      return this._cleanupService.performMemorySynthesis();
  }

  async decayConfidence(factor: number, olderThan: number | Date) {
    const threshold = olderThan instanceof Date ? olderThan.getTime() : olderThan;
    const rows = await this._db.selectWhere('agent_knowledge' as any, [
      { column: 'userId', value: this.userId },
      { column: 'createdAt', value: threshold, operator: '<' },
    ]);
    for (const row of rows) {
      const current = (row.confidence as number) ?? 1.0;
      await this._push({
        type: 'update',
        table: 'agent_knowledge' as any,
        where: [{ column: 'id', value: row.id }],
        values: { confidence: Math.max(0, current * factor) },
        layer: 'infrastructure',
      });
    }
    return { decayedCount: rows.length };
  }
  async reembedAll() {
    return { embeddedCount: 0, skippedCount: 0 }; // Placeholder for migration
  }
  getCacheStats() {
    return {
      hits: this._kbCache.hits,
      misses: this._kbCache.misses,
      size: this._kbCache.size,
    };
  }
  async getAgentBundle(agentId: string): Promise<AgentBundle> {
    const profile = await this.getAgentProfile(agentId);
    const tasks = await this._db.selectWhere('agent_tasks' as any, [
      { column: 'agentId', value: agentId },
      { column: 'status', value: ['pending', 'active'], operator: 'IN' },
    ]);
    
    const results = await this._db.selectWhere('agent_knowledge' as any, [
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

  public async getTaskById(taskId: string): Promise<any> {
    const tResults = await this._db.selectWhere('agent_tasks' as any, [
      { column: 'id', value: taskId },
    ]);
    return tResults.length > 0 ? tResults[0] : null;
  }

  // Helper for bundle
  private async getAgentProfile(agentId: string): Promise<AgentProfile> {
    const results = await this._db.selectWhere('agent_streams' as any, [{ column: 'id', value: agentId }]);
    const row = results.length > 0 ? results[0] : { id: agentId, status: 'active' } as any;
    return {
      agentId: row.id,
      name: row.externalId || row.id,
      role: 'swarm-agent',
      status: row.status as any,
      permissions: [],
      createdAt: row.createdAt || Date.now(),
      lastActive: Date.now()
    };
  }
}
