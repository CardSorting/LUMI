// [LAYER: CORE]
// @classification INTERNAL
import { AuditService } from './agent-context/AuditService.js';
import { CleanupService } from './agent-context/CleanupService.js';
import { GraphService } from './agent-context/GraphService.js';
import { LspService } from './agent-context/LspService.js';
import { MailboxService } from './agent-context/MailboxService.js';
import { MutexService } from './agent-context/MutexService.js';
import { ReasoningService } from './agent-context/ReasoningService.js';
import { SpiderService } from './agent-context/SpiderService.js';
import { TaskService } from './agent-context/TaskService.js';
import { CompactService } from './agent-context/CompactService.js';
import { TokenService } from './agent-context/TokenService.js';
import { CoordinatorService } from './agent-context/CoordinatorService.js';
import { ScratchpadService } from './agent-context/ScratchpadService.js';
import { InvariantEngine } from './agent-context/InvariantEngine.js';
import { LifecycleRegistry } from './agent-context/LifecycleRegistry.js';
import { COMPATIBILITY_EXCEPTIONS } from './agent-context/compatibility-purge.js';
import { StorageCapability } from './agent-context/capabilities/StorageCapability.js';
import { TelemetryCapability } from './agent-context/capabilities/TelemetryCapability.js';
import { RecoveryCapability } from './agent-context/capabilities/RecoveryCapability.js';
import { AuditCapability } from './agent-context/capabilities/AuditCapability.js';
import { CoordinationCapability } from './agent-context/capabilities/CoordinationCapability.js';
import { QueryCapability } from './agent-context/capabilities/QueryCapability.js';
import { SnapshotCapability } from './agent-context/capabilities/SnapshotCapability.js';
import { GraphCapability } from './agent-context/capabilities/GraphCapability.js';
import { ReasoningCapability } from './agent-context/capabilities/ReasoningCapability.js';
import { TaskCapability } from './agent-context/capabilities/TaskCapability.js';
import { ScratchpadCapability } from './agent-context/capabilities/ScratchpadCapability.js';
import { MailboxCapability } from './agent-context/capabilities/MailboxCapability.js';
import { IntentTracer } from './agent-context/IntentTracer.js';
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
export type * from './agent-context/capability-types.js';
export type { CapabilityHealth } from './agent-context/capability-health.js';
export { CapabilityBase } from './agent-context/CapabilityBase.js';
export type * from './agent-context/intent-types.js';
export { IntentTracer } from './agent-context/IntentTracer.js';

import type { BroccoliDbHealth, KnowledgeBaseItem, ServiceContext } from './agent-context/types.js';
import type { CapabilityHealth } from './agent-context/capability-health.js';
import { LRUCache } from './lru-cache.js';
import type { Workspace } from './workspace.js';

/**
 * AgentContext is a lifecycle-owned capability façade.
 * All agent-facing operations route through named capabilities.
 */
export class AgentContext {
  private lifecycleState: 'new' | 'starting' | 'started' | 'stopping' | 'stopped' = 'new';
  private readonly _db: BufferedDbPool;
  private readonly _kbCache: LRUCache<string, KnowledgeBaseItem>;
  private readonly _serviceContext: ServiceContext;
  private _mailboxService: MailboxService;

  private readonly _graphService: GraphService;
  private readonly _reasoningService: ReasoningService;
  private readonly _taskService: TaskService;
  private readonly _auditService: AuditService;
  private readonly _spiderService: SpiderService;
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
  private readonly _graphCapability: GraphCapability;
  private readonly _reasoningCapability: ReasoningCapability;
  private readonly _taskCapability: TaskCapability;
  private readonly _scratchpadCapability: ScratchpadCapability;
  private readonly _mailboxCapability: MailboxCapability;
  private readonly _intentTracer: IntentTracer;

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
      workspace,
      userId: this.userId,
      push: (op, agentId) => this._push(op, agentId),
      pushBatch: (ops) => this._pushBatch(ops),
      searchKnowledge: async () => {
        throw new LifecycleStateError('ServiceContext.searchKnowledge wired after capabilities.');
      },
      updateTaskStatus: async () => {
        throw new LifecycleStateError('ServiceContext.updateTaskStatus wired after capabilities.');
      },
      getStructuralImpact: () => {
        throw new LifecycleStateError('ServiceContext.getStructuralImpact wired after capabilities.');
      },
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
    this._auditService = new AuditService(this._serviceContext, this._graphService, this._reasoningService);
    this._spiderService = new SpiderService(this._serviceContext);
    this._mailboxService = new MailboxService(this._serviceContext);
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
    const isStarted = () => this.lifecycleState === 'started';
    this._intentTracer = new IntentTracer(this.userId, this._db);

    this._storageCapability = new StorageCapability(
      this._storageService,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._telemetryCapability = new TelemetryCapability(
      this._push.bind(this),
      workspace,
      this.userId,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._graphCapability = new GraphCapability(
      this._graphService,
      this._spiderService,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._reasoningCapability = new ReasoningCapability(
      this._reasoningService,
      this._db,
      this.userId,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._taskCapability = new TaskCapability(
      this._taskService,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._scratchpadCapability = new ScratchpadCapability(
      this._scratchpadService,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._mailboxCapability = new MailboxCapability(
      this._mailboxService,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._recoveryCapability = new RecoveryCapability(
      this._db,
      this._kbCache,
      this._graphService,
      this._cleanupService,
      this.userId,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._auditCapability = new AuditCapability(
      this._invariantEngine,
      this._auditService,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._coordinationCapability = new CoordinationCapability(
      this._mutexService,
      this._coordinatorService,
      (mailbox) => {
        this._mailboxService = mailbox;
      },
      (mailbox) => {
        this._serviceContext.mailbox = mailbox;
      },
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._queryCapability = new QueryCapability(
      this._db,
      this._graphService,
      this._reasoningService,
      workspace,
      this.userId,
      this._push.bind(this),
      this._serviceContext,
      () => this.getCacheStats(),
      () => this._coordinationCapability.getTeammates().teammates,
      assertOperational,
      isStarted,
      this._intentTracer
    );
    this._snapshotCapability = new SnapshotCapability(
      (input) => this._storageCapability.store(input),
      this.health.bind(this),
      assertOperational,
      isStarted,
      this._intentTracer
    );

    this._serviceContext.searchKnowledge = async (query, tags, limit, _emb, options) => {
      const result = await this._queryCapability.search({
        text: query,
        tags,
        limit,
        skipVerification: options?.skipVerification,
      });
      return result.items;
    };
    this._serviceContext.updateTaskStatus = async (taskId, status, result) => {
      await this._taskCapability.updateStatus({ taskId, status, result });
    };
    this._serviceContext.getStructuralImpact = (filePath) =>
      this._graphCapability.getStructuralImpact({ filePath });

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
    this._lifecycleRegistry.register('lsp', ctx.lsp);
    this._lifecycleRegistry.register('coordinator', this._coordinatorService);
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

  public async flush(): Promise<void> {
    this.assertOperational('flush');
    await this._lifecycleRegistry.flushAll();
    if (this._intentTracer.isDurableModeEnabled()) {
      await this._intentTracer.flush();
    }
  }

  public async health(options: { deep?: boolean } = {}): Promise<BroccoliDbHealth> {
    const registry = await this._lifecycleRegistry.healthAll(options);
    const capabilities = await this.collectCapabilityHealth();
    const compatibilityBridgeViolations = this.auditCompatibilityBridges();
    const invariantViolations = options.deep
      ? (await this._auditCapability.invariants()).violations
      : undefined;
    const status =
      this.lifecycleState === 'stopped' || this.lifecycleState === 'new'
        ? 'stopped'
        : compatibilityBridgeViolations.length > 0
          ? 'critical'
          : invariantViolations && invariantViolations.length > 0
            ? 'critical'
            : 'healthy';

    return {
      status,
      lifecycle: this.lifecycleState,
      registry,
      capabilities,
      cache: this.getCacheStats(),
      intent: this._intentTracer.health(),
      invariantViolations,
      compatibilityBridgeViolations:
        compatibilityBridgeViolations.length > 0 ? compatibilityBridgeViolations : undefined,
    };
  }

  public enableDurableIntentTraces(): void {
    this._intentTracer.enableDurableMode();
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
  public get audit() {
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
  public get graph() {
    return this._graphCapability;
  }
  public get reasoning() {
    return this._reasoningCapability;
  }
  public get tasks() {
    return this._taskCapability;
  }
  public get scratchpad() {
    return this._scratchpadCapability;
  }
  public get mailbox() {
    return this._mailboxCapability;
  }

  private assertOperational(operation: string): void {
    if (this.lifecycleState === 'new' || this.lifecycleState === 'starting') {
      throw new LifecycleStateError(`AgentContext.${operation} called before start().`);
    }
    if (this.lifecycleState === 'stopping') {
      throw new LifecycleStateError(`AgentContext.${operation} called while stop() is in progress.`);
    }
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError(`AgentContext.${operation} called after stop().`);
    }
  }

  private async _push(op: WriteOp, agentId?: string) {
    this.assertOperational('_push');
    await this._db.push(op, agentId);
  }

  private async _pushBatch(ops: WriteOp[], agentId?: string) {
    this.assertOperational('_pushBatch');
    await this._db.pushBatch(ops, agentId);
  }

  private getCacheStats() {
    return {
      hits: this._kbCache.hits,
      misses: this._kbCache.misses,
      size: this._kbCache.size,
    };
  }

  private async collectCapabilityHealth(): Promise<Record<string, CapabilityHealth>> {
    const entries = await Promise.all([
      ['storage', await this._storageCapability.health()],
      ['telemetry', await this._telemetryCapability.health()],
      ['recovery', await this._recoveryCapability.health()],
      ['audit', await this._auditCapability.health()],
      ['coordination', await this._coordinationCapability.health()],
      ['query', await this._queryCapability.health()],
      ['snapshots', await this._snapshotCapability.health()],
      ['graph', await this._graphCapability.health()],
      ['reasoning', await this._reasoningCapability.health()],
      ['tasks', await this._taskCapability.health()],
      ['scratchpad', await this._scratchpadCapability.health()],
      ['mailbox', await this._mailboxCapability.health()],
    ] as const);
    return Object.fromEntries(entries);
  }

  private auditCompatibilityBridges(): string[] {
    const violations: string[] = [];
    for (const exception of COMPATIBILITY_EXCEPTIONS) {
      if (!exception.deletionDate) {
        violations.push(`Compatibility exception '${exception.symbol}' missing deletionDate`);
      }
    }
    return violations;
  }
}
