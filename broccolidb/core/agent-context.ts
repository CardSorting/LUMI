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
import { StorageCapability } from './agent-context/capabilities/StorageCapability.js';
import { TelemetryCapability } from './agent-context/capabilities/TelemetryCapability.js';
import { RecoveryCapability } from './agent-context/capabilities/RecoveryCapability.js';
import { AuditCapability } from './agent-context/capabilities/AuditCapability.js';
import { CoordinationCapability } from './agent-context/capabilities/CoordinationCapability.js';
import { QueryCapability } from './agent-context/capabilities/QueryCapability.js';
import { SnapshotCapability } from './agent-context/capabilities/SnapshotCapability.js';
import {
  StreamingToolExecutor,
  type ToolCall,
  type ToolExecutorOptions,
  type ToolResult,
} from './agent-context/StreamingToolExecutor.js';
import { StorageService } from '../infrastructure/storage/StorageService.js';
import { BufferedDbPool, type WriteOp } from '../infrastructure/db/BufferedDbPool.js';
import { AgentGitError, LifecycleStateError } from './errors.js';

export { StreamingToolExecutor } from './agent-context/StreamingToolExecutor.js';
export type {
  AgentBundle,
  AgentProfile,
  BroccoliDbCacheStats,
  BroccoliDbHealth,
  BroccoliDbRecoveryReport,
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
  AgentProfile,
  BroccoliDbHealth,
  BroccoliDbRecoveryReport,
  KnowledgeBaseItem,
  Pedigree,
  ServiceContext,
  ToolDef,
  TraversalFilter,
} from './agent-context/types.js';
import { LRUCache } from './lru-cache.js';
import type { Workspace } from './workspace.js';

/**
 * AgentContext is a capability façade over owned services — not a god object.
 * Domain logic lives in services and narrow capability modules.
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

  private readonly _storageCapability: StorageCapability;
  private readonly _telemetryCapability: TelemetryCapability;
  private readonly _recoveryCapability: RecoveryCapability;
  private readonly _auditCapability: AuditCapability;
  private readonly _coordinationCapability: CoordinationCapability;
  private readonly _queryCapability: QueryCapability;
  private readonly _snapshotCapability: SnapshotCapability;

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

    const assertOperational = this.assertOperational.bind(this);
    this._storageCapability = new StorageCapability(this._storageService, assertOperational);
    this._telemetryCapability = new TelemetryCapability(
      this._push.bind(this),
      workspace,
      this.userId,
      assertOperational
    );
    this._recoveryCapability = new RecoveryCapability(
      this._db,
      this._kbCache,
      this._graphService,
      this.userId,
      assertOperational
    );
    this._auditCapability = new AuditCapability(this._invariantEngine, assertOperational);
    this._coordinationCapability = new CoordinationCapability(
      this._serviceContext,
      (mailbox) => {
        this._mailboxService = mailbox;
      }
    );
    this._queryCapability = new QueryCapability(
      this._db,
      this._graphService,
      this._reasoningService,
      workspace,
      this.userId,
      this._push.bind(this),
      assertOperational
    );
    this._snapshotCapability = new SnapshotCapability(
      this._storageCapability,
      this.health.bind(this),
      assertOperational
    );

    const ctx = this._serviceContext as any;
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

  public setSharedMailbox(mailbox: MailboxService) {
    this._coordinationCapability.setSharedMailbox(mailbox);
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
    return this._storageCapability.store(content);
  }

  public async hydrate(hash: string): Promise<string | null> {
    return this._storageCapability.hydrate(hash);
  }

  public async recordTelemetry(event: {
    usage: { promptTokens: number; completionTokens: number; modelId?: string };
    agentId?: string;
    taskId?: string | null;
    repoPath?: string;
  }): Promise<void> {
    return this._telemetryCapability.record(event);
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
          ? 'critical'
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
    return this._snapshotCapability.snapshot(metadata);
  }

  public async recover(): Promise<BroccoliDbRecoveryReport> {
    return this._recoveryCapability.recover();
  }

  public async auditInvariants(): Promise<string[]> {
    return this._auditCapability.auditInvariants();
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
  public get storageService() {
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

  public get storage() {
    return this._storageCapability;
  }
  public get telemetry() {
    return this._telemetryCapability;
  }
  public get recovery() {
    return this._recoveryCapability;
  }
  public get auditCapability() {
    return this._auditCapability;
  }
  public get coordination() {
    return this._coordinationCapability;
  }
  public get query() {
    return this._queryCapability;
  }
  public get snapshots() {
    return this._snapshotCapability;
  }

  public registerTeammate(agentId: string) {
    this._coordinationCapability.registerTeammate(agentId);
  }

  public async retractLastOperation() {
    return this._recoveryCapability.retractLastOperation();
  }

  public getTeammates(): string[] {
    return this._coordinationCapability.getTeammates();
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
  async speculateImpact(content: string, _startId?: string) {
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

  async reconstituteFromDigest(digest: string): Promise<void> {
    return this._recoveryCapability.reconstituteFromDigest(digest);
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
    return this._queryCapability.appendSharedMemory(memory);
  }

  // ─── ANALYTICS BRIDGES ───
  async getNodeCentrality(kbId: string) {
    return this._graphService.getNodeCentrality(kbId);
  }
  async getGlobalCentrality(limit?: number) {
    return this._queryCapability.getGlobalCentrality(limit);
  }
  async extractSubgraph(rootId: string, maxDepth = 2, filter?: TraversalFilter) {
    return this._graphService.extractSubgraph(rootId, maxDepth, filter);
  }

  // ─── SEARCH & VERIFICATION ───
  public async verifyKnowledgeBatch(
    itemIds: string[]
  ): Promise<Map<string, { isValid: boolean; confidence: number }>> {
    return this._queryCapability.verifyKnowledgeBatch(itemIds);
  }

  async searchKnowledge(
    query: string,
    tags?: string[],
    limit = 20,
    _queryEmbedding?: number[],
    options: { augmentWithGraph?: boolean; skipVerification?: boolean } = {}
  ): Promise<KnowledgeBaseItem[]> {
    return this._queryCapability.searchKnowledge(query, tags, limit, _queryEmbedding, options);
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
    return this._queryCapability.decayConfidence(factor, olderThan);
  }
  async reembedAll() {
    return { embeddedCount: 0, skippedCount: 0 };
  }
  getCacheStats() {
    return {
      hits: this._kbCache.hits,
      misses: this._kbCache.misses,
      size: this._kbCache.size,
    };
  }
  async getAgentBundle(agentId: string): Promise<import('./agent-context/types.js').AgentBundle> {
    return this._queryCapability.getAgentBundle(agentId);
  }

  public async getTaskById(taskId: string): Promise<any> {
    return this._queryCapability.getTaskById(taskId);
  }
}
