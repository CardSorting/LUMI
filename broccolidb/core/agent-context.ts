// [LAYER: CORE]
// @classification MODERN
import { randomUUID } from 'node:crypto';
import { AuditService } from './agent-context/AuditService.js';
import { CleanupService } from './agent-context/CleanupService.js';
import { DiagnosisService } from './agent-context/DiagnosisService.js';
import { GraphService } from './agent-context/GraphService.js';
import { LspService } from './agent-context/LspService.js';
import { MailboxService } from './agent-context/MailboxService.js';
import { MutexService } from './agent-context/MutexService.js';

import { ReasoningService } from './agent-context/ReasoningService.js';
import { SideQueryService } from './agent-context/SideQueryService.js';
import { SpiderService } from './agent-context/SpiderService.js';
import { TaskService } from './agent-context/TaskService.js';
import { CompactService } from './agent-context/CompactService.js';
import { TokenService } from './agent-context/TokenService.js';
import { CoordinatorService } from './agent-context/CoordinatorService.js';
import { ScratchpadService } from './agent-context/ScratchpadService.js';
import { InvariantEngine } from './agent-context/InvariantEngine.js';
import { LifecycleRegistry } from './agent-context/LifecycleRegistry.js';
import {
  StreamingToolExecutor,
  type ToolCall,
  type ToolExecutorOptions,
  type ToolResult,
} from './agent-context/StreamingToolExecutor.js';
import { StorageService } from '../infrastructure/storage/StorageService.js';
import { BufferedDbPool, type WriteOp } from '../infrastructure/db/BufferedDbPool.js';
import { AgentGitError, LifecycleStateError, RecoveryError } from './errors.js';

export { StreamingToolExecutor } from './agent-context/StreamingToolExecutor.js';
export type {
  AgentBundle,
  AgentProfile,
  GraphEdge,
  ImpactReport,
  KnowledgeBaseItem,
  MemoryMessage,
  Pedigree,
  PromptSuggestion,
  ServiceContext,
  TaskContext,
  TaskItem,
  ToolDef,
  ToolUseContext,
  TraversalFilter,
} from './agent-context/types.js';
export type {
  ToolCall,
  ToolExecutionProgress,
  ToolExecutorOptions,
  ToolResult,
} from './agent-context/StreamingToolExecutor.js';

import type {
  AgentBundle,
  AgentProfile,
  ImpactReport,
  KnowledgeBaseItem,
  Pedigree,
  ServiceContext,
  ToolDef,
  TraversalFilter,
} from './agent-context/types.js';
import { LRUCache } from './lru-cache.js';
import type { Workspace } from './workspace.js';

export interface BroccoliDbCacheStats {
  hits: number;
  misses: number;
  size: number;
}

export interface BroccoliDbHealth {
  status: 'healthy' | 'stopped' | 'unhealthy';
  lifecycle: 'new' | 'starting' | 'started' | 'stopping' | 'stopped';
  registry: Record<string, unknown>;
  cache: BroccoliDbCacheStats;
  invariantViolations?: string[];
}

export interface BroccoliDbRecoveryReport {
  recovered: boolean;
  warmedTables: Record<string, number>;
  errors: string[];
}

/**
 * AgentContext provides a unified entry point for BroccoliDB's epistemic
 * and task-related operations. It coordinates specialized services for
 * graph management, reasoning, auditing, and structural discovery.
 */
export class AgentContext {
  private lifecycleState: 'new' | 'starting' | 'started' | 'stopping' | 'stopped' = 'new';
  private readonly _db: BufferedDbPool;
  private readonly _kbCache: LRUCache<string, KnowledgeBaseItem>;
  private readonly _serviceContext: ServiceContext;

  private readonly _graphService: GraphService;
  private readonly _reasoningService: ReasoningService;
  private readonly _taskService: TaskService;
  private readonly _auditService: AuditService;
  private readonly _spiderService: SpiderService;
  private readonly _diagnosisService: DiagnosisService;
  private _mailboxService: MailboxService;
  private readonly _sideQueryService: SideQueryService;
  private readonly _mutexService: MutexService;
  private readonly _cleanupService: CleanupService;
  private readonly _lspService: LspService;
  private readonly _compactService: CompactService;
  private readonly _tokenService: TokenService;
  private readonly _coordinatorService: CoordinatorService;
  private readonly _scratchpadService: ScratchpadService;
  private readonly _storageService: StorageService;
  private readonly _lifecycleRegistry: LifecycleRegistry;
  private readonly _invariantEngine: InvariantEngine;
  private readonly _teammates: Set<string> = new Set();

  public readonly userId: string;

  constructor(
    workspace: Workspace,
    db?: BufferedDbPool,
    userId?: string,
    _profile?: { agentId: string; name: string }
  ) {
    this._db = db || workspace.getDb();
    const resolvedUserId = userId?.trim() || workspace.userId.trim();
    if (!resolvedUserId) {
      throw new AgentGitError('userId is required', 'INVALID_USER_ID');
    }
    this.userId = resolvedUserId;
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
      pasteStore: undefined as any,
      compact: undefined as any,
      storage: undefined as any,
      token: undefined as any,
      lsp: undefined as any,
      coordinator: undefined as any,
      scratchpad: undefined as any,
      mailbox: undefined as any,
      spider: undefined as any,
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
    this._sideQueryService = new SideQueryService(this._serviceContext);
    this._mutexService = new MutexService(this._serviceContext);
    this._compactService = new CompactService(this._serviceContext);
    this._tokenService = new TokenService();
    this._coordinatorService = new CoordinatorService(this._serviceContext);
    this._scratchpadService = new ScratchpadService(this._serviceContext);
    this._storageService = new StorageService(this._serviceContext);
    this._cleanupService = new CleanupService(this._serviceContext, this._taskService, this._reasoningService);
    this._lspService = new LspService(this._serviceContext);
    this._lifecycleRegistry = new LifecycleRegistry();
    this._invariantEngine = new InvariantEngine(process.cwd());

    // Final bootstrap
    const ctx = this._serviceContext as any;
    ctx.pasteStore = this._storageService;
    ctx.compact = this._compactService;
    ctx.storage = this._storageService;
    ctx.token = this._tokenService;
    ctx.lsp = this._lspService;
    ctx.coordinator = this._coordinatorService;
    ctx.scratchpad = this._scratchpadService;
    ctx.mailbox = this._mailboxService;
    ctx.spider = this._spiderService;

    this._lifecycleRegistry.register('db', this._db);
    this._lifecycleRegistry.register('storage', this._storageService);
    this._lifecycleRegistry.register('cleanup', this._cleanupService);
    this._lifecycleRegistry.register('mutex', this._mutexService);
    this._lifecycleRegistry.register('lsp', this._lspService);
    this._lifecycleRegistry.register('coordinator', this._coordinatorService);
  }

  /**
   * Overrides the mailbox with a shared instance for swarm coordination.
   */
  public setSharedMailbox(mailbox: MailboxService) {
    this._mailboxService = mailbox;
    this._serviceContext.mailbox = mailbox;
  }

  public async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError('AgentContext cannot be restarted after stop().');
    }
    this.lifecycleState = 'starting';
    try {
      await this._lifecycleRegistry.startAll();
      await this._serviceContext.workspace.init();
      this.lifecycleState = 'started';
    } catch (error) {
      this.lifecycleState = 'new';
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.lifecycleState === 'stopped') return;
    if (this.lifecycleState === 'new') {
      this.lifecycleState = 'stopped';
      return;
    }
    this.lifecycleState = 'stopping';
    this._mailboxService.clear();
    await this._lifecycleRegistry.stopAll();
    this.lifecycleState = 'stopped';
  }

  private assertOperational(operation: string): void {
    if (this.lifecycleState === 'new' || this.lifecycleState === 'starting') {
      throw new LifecycleStateError(`AgentContext.${operation}() called before start().`);
    }
    if (this.lifecycleState === 'stopping') {
      throw new LifecycleStateError(`AgentContext.${operation}() called while stop() is in progress.`);
    }
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError(`AgentContext.${operation}() called after stop().`);
    }
  }

  public async store(content: string): Promise<string> {
    this.assertOperational('store');
    return this._storageService.storeContent(content);
  }

  public async hydrate(hash: string): Promise<string | null> {
    this.assertOperational('hydrate');
    return this._storageService.hydrateContent(hash);
  }

  public async recordTelemetry(event: {
    usage: { promptTokens: number; completionTokens: number; modelId?: string };
    agentId?: string;
    taskId?: string | null;
    repoPath?: string;
  }): Promise<void> {
    this.assertOperational('recordTelemetry');
    const promptTokens = event.usage.promptTokens;
    const completionTokens = event.usage.completionTokens;
    await this._push({
      type: 'insert',
      table: 'telemetry',
      values: {
        id: randomUUID(),
        repoPath: event.repoPath ?? this._serviceContext.workspace.workspacePath,
        agentId: event.agentId ?? this.userId,
        taskId: event.taskId ?? null,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        modelId: event.usage.modelId ?? 'unknown',
        cost: 0,
        timestamp: Date.now(),
        environment: JSON.stringify({ source: 'AgentContext.recordTelemetry' }),
      },
      layer: 'infrastructure',
    });
  }

  async flush(): Promise<void> {
    this.assertOperational('flush');
    return this._lifecycleRegistry.flushAll();
  }

  public async health(options: { deep?: boolean } = {}): Promise<BroccoliDbHealth> {
    const registry = await this._lifecycleRegistry.healthAll(options);
    const invariantViolations = options.deep ? await this.auditInvariants() : undefined;
    const status =
      this.lifecycleState === 'stopped' || this.lifecycleState === 'new'
        ? 'stopped'
        : invariantViolations && invariantViolations.length > 0
          ? 'unhealthy'
          : 'healthy';

    return {
      status,
      lifecycle: this.lifecycleState,
      registry,
      cache: this.getCacheStats(),
      invariantViolations,
    };
  }

  public async snapshot(metadata: Record<string, unknown> = {}): Promise<string> {
    this.assertOperational('snapshot');
    const payload = {
      metadata,
      createdAt: new Date().toISOString(),
      health: await this.health(),
    };
    return this.store(JSON.stringify(payload));
  }

  public async recover(): Promise<BroccoliDbRecoveryReport> {
    this.assertOperational('recover');
    const warmedTables: Record<string, number> = {};
    const errors: string[] = [];
    const warmups: Array<[any, string, string]> = [
      ['queue_jobs', 'status', 'pending'],
      ['agent_streams', 'status', 'active'],
      ['agent_tasks', 'status', 'pending'],
      ['agent_tasks', 'status', 'running'],
    ];

    for (const [table, column, value] of warmups) {
      try {
        warmedTables[`${String(table)}:${column}:${value}`] = await this._db.warmupTable(
          table as any,
          column,
          value
        );
      } catch (error: any) {
        errors.push(`${String(table)}:${column}:${value}: ${error?.message || error}`);
      }
    }

    if (errors.length > 0) {
      throw new RecoveryError(`BroccoliDB recovery failed: ${errors.join('; ')}`);
    }

    return { recovered: true, warmedTables, errors };
  }

  public async auditInvariants(): Promise<string[]> {
    return this._invariantEngine.auditInvariants();
  }

  public get db() {
    console.warn('[AgentContext] db getter is deprecated. Use typed AgentContext methods instead.');
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
  /**
   * @deprecated TRANSITIONAL alias. Use storageService directly.
   * Deletion Condition: Safe to remove once all downstream tests and packages migrate to calling StorageService.
   */
  public get pasteStore() {
    console.warn('[AgentContext] pasteStore getter is deprecated. Use storage/store/hydrate APIs instead.');
    return this._storageService;
  }
  public get compact() {
    return this._compactService;
  }
  public get token() {
    return this._tokenService;
  }
  public get coordinator() {
    return this._coordinatorService;
  }
  public get scratchpad() {
    return this._scratchpadService;
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

  public createToolExecutor(tools: ToolDef[], options: ToolExecutorOptions = {}) {
    this.assertOperational('createToolExecutor');
    return new StreamingToolExecutor(tools, this._serviceContext, options);
  }

  public async executeTools(
    calls: ToolCall[],
    tools: ToolDef[],
    options: ToolExecutorOptions = {}
  ): Promise<ToolResult[]> {
    this.assertOperational('executeTools');
    const executor = this.createToolExecutor(tools, options);
    const results: ToolResult[] = [];
    for await (const result of executor.executeBatch(calls)) {
      results.push(result);
    }
    return results;
  }

  public getErgonomicsSnapshot() {
    this.assertOperational('getErgonomicsSnapshot');
    return {
      userId: this.userId,
      workspaceId: this._serviceContext.workspace.workspaceId,
      workspacePath: this._serviceContext.workspace.workspacePath,
      teammates: this.getTeammates(),
      cache: this.getCacheStats(),
      services: {
        graph: true,
        reasoning: true,
        audit: true,
        spider: true,
        mailbox: true,
        lsp: true,
        coordinator: true,
        scratchpad: true,
      },
      toolExecutionDefaults: {
        timeoutMs: 60000,
        maxParallelReads: 8,
        mirrorFileChanges: true,
        failOnUnsafeMutationPath: true,
        recordAuditEvents: true,
      },
    };
  }

  /**
   * @deprecated Use stop(). Kept only as a transitional alias and scheduled for deletion.
   */
  public async shutdown(): Promise<void> {
    await this.stop();
  }

  public async dispose(): Promise<void> {
    await this.stop();
  }

  private async _push(op: WriteOp, agentId?: string) {
    this.assertOperational('_push');
    await this._db.push(op, agentId);
  }

  private async _pushBatch(ops: WriteOp[], agentId?: string) {
    this.assertOperational('_pushBatch');
    await this._db.pushBatch(ops, agentId);
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
      `note-${randomUUID()}`,
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
      deficiencies: discovery.getDeficiencyReport(filePath),
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
