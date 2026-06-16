// [LAYER: CORE]
import type { OwnedComponent } from '../../../agent-context/LifecycleRegistry.js';
import { lifecycleHealth, type ServiceHealth } from '../../../agent-context/service-health.js';
import type { BufferedDbPool } from '../../../../infrastructure/db/BufferedDbPool.js';
import type { StorageService } from '../../../../infrastructure/storage/StorageService.js';
import type { RuntimeMode } from '../../runtime/types.js';
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import type { ExecutionSession } from '../../types.js';
import { RuntimeGraphSerializer } from './RuntimeGraphSerializer.js';
import { RuntimeSnapshotStore } from './RuntimeSnapshotStore.js';
import { RuntimeIntegrityVerifier } from './RuntimeIntegrityVerifier.js';
import { RuntimeMigrationEngine } from './RuntimeMigrationEngine.js';
import { RuntimeCompactor } from './RuntimeCompactor.js';
import { RuntimeIndex } from './RuntimeIndex.js';
import { RuntimeReplayHydrator } from './RuntimeReplayHydrator.js';
import type { RuntimeMemoryHealth, RuntimeSnapshot, CompactionResult } from './types.js';

export interface RuntimeGraphStoreDeps {
  graph: RuntimeStateGraph;
  db?: BufferedDbPool;
  storage?: StorageService;
  userId?: string;
}

export class RuntimeGraphStore implements OwnedComponent {
  private lifecycleState: 'new' | 'started' | 'stopped' = 'new';
  private readonly serializer = new RuntimeGraphSerializer();
  private readonly migration = new RuntimeMigrationEngine();
  private readonly integrity = new RuntimeIntegrityVerifier();
  private readonly snapshotStore: RuntimeSnapshotStore;
  private readonly compactor: RuntimeCompactor;
  private readonly hydrator: RuntimeReplayHydrator;
  readonly index = new RuntimeIndex();

  private lastIntegrityCheck?: number;
  private lastIntegrityViolations = 0;
  private compactionBeforeTotal = 0;
  private compactionAfterTotal = 0;
  private pendingFlushSessions = new Set<string>();

  constructor(private readonly deps: RuntimeGraphStoreDeps) {
    this.snapshotStore = new RuntimeSnapshotStore(
      this.serializer,
      deps.db,
      deps.storage,
      deps.userId
    );
    this.compactor = new RuntimeCompactor(this.snapshotStore);
    this.hydrator = new RuntimeReplayHydrator(
      this.snapshotStore,
      this.serializer,
      this.migration,
      this.integrity
    );
  }

  get replayHydrator(): RuntimeReplayHydrator {
    return this.hydrator;
  }

  get snapshots(): RuntimeSnapshotStore {
    return this.snapshotStore;
  }

  async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    if (this.deps.db && this.deps.userId) {
      await this.recoverFromDb();
    }
    this.lifecycleState = 'started';
  }

  async stop(): Promise<void> {
    if (this.lifecycleState === 'stopped') return;
    await this.flush();
    this.snapshotStore.clear();
    this.index.clear();
    this.pendingFlushSessions.clear();
    this.lifecycleState = 'stopped';
  }

  async flush(): Promise<void> {
    if (this.lifecycleState !== 'started') return;
    for (const sessionId of this.pendingFlushSessions) {
      await this.snapshotStore.save(this.deps.graph, sessionId, 'development');
    }
    this.pendingFlushSessions.clear();
  }

  async health(): Promise<ServiceHealth> {
    const mem = this.getMemoryHealth([]);
    return lifecycleHealth('runtime-graph-store', this.lifecycleState, {
      degraded: mem.graphIntegrity === 'degraded',
      critical: mem.graphIntegrity === 'corrupted',
      metrics: mem as unknown as Record<string, number | string | boolean | null>,
    });
  }

  markDirty(sessionId: string): void {
    this.pendingFlushSessions.add(sessionId);
  }

  async snapshot(sessionId: string, mode: RuntimeMode): Promise<RuntimeSnapshot> {
    this.assertStarted('snapshot');
    const report = this.integrity.verify(this.deps.graph, sessionId);
    this.lastIntegrityCheck = report.checkedAt;
    this.lastIntegrityViolations = report.violations.length;

    if (!report.healthy) {
      throw new Error(
        `Cannot snapshot session with integrity violations: ${report.violations.map((v) => v.diagnosticId).join(', ')}`
      );
    }

    return this.snapshotStore.save(this.deps.graph, sessionId, mode);
  }

  async compact(sessionId: string, mode: RuntimeMode): Promise<CompactionResult> {
    this.assertStarted('compact');
    const result = await this.compactor.compact(this.deps.graph, sessionId, mode);
    this.compactionBeforeTotal += result.beforeNodes;
    this.compactionAfterTotal += result.afterNodes;
    return result;
  }

  verifySession(sessionId: string, session?: ExecutionSession) {
    const report = this.integrity.verify(this.deps.graph, sessionId, session);
    this.lastIntegrityCheck = report.checkedAt;
    this.lastIntegrityViolations = report.violations.length;
    return report;
  }

  hydrateGraph(sessionId: string, serialized: import('./types.js').SerializedRuntimeGraph): void {
    this.deps.graph.hydrate(sessionId, serialized.nodes, serialized.edges);
  }

  getMemoryHealth(sessionIds: string[]): RuntimeMemoryHealth {
    let orphaned = 0;
    let dangling = 0;
    for (const id of sessionIds) {
      const report = this.integrity.verify(this.deps.graph, id);
      orphaned += report.violations.filter((v) => v.diagnosticId === 'RTG-001').length;
      dangling += report.violations.filter((v) => v.diagnosticId === 'RTG-002').length;
    }

    let graphIntegrity: RuntimeMemoryHealth['graphIntegrity'] = 'healthy';
    if (this.lastIntegrityViolations > 0) graphIntegrity = 'degraded';
    if (this.lastIntegrityViolations > 5) graphIntegrity = 'corrupted';

    const compactionRatio =
      this.compactionBeforeTotal > 0
        ? Math.round((1 - this.compactionAfterTotal / this.compactionBeforeTotal) * 100) / 100
        : 1;

    return {
      graphIntegrity,
      snapshotCount: this.snapshotStore.count,
      replayableSessions: new Set(this.snapshotStore.list().map((s) => s.sessionId)).size,
      orphanedNodes: orphaned,
      danglingEdges: dangling,
      compactionRatio,
      integrityViolations: this.lastIntegrityViolations,
      lastIntegrityCheck: this.lastIntegrityCheck,
      lastSuccessfulSnapshot: this.snapshotStore.getLastSuccessfulSnapshotTime(),
      migrationStatus: this.migration.getStatus(),
    };
  }

  private async recoverFromDb(): Promise<void> {
    if (!this.deps.db || !this.deps.userId) return;
    const rows = await this.deps.db.selectWhere('audit_events', [
      { column: 'userId', value: this.deps.userId },
      { column: 'type', value: 'runtime_snapshot' },
    ]);
    for (const row of rows) {
      try {
        const data = JSON.parse(String((row as { data: string }).data)) as RuntimeSnapshot;
        this.snapshotStore.register(data);
      } catch {
        // skip corrupt rows
      }
    }
  }

  private assertStarted(op: string): void {
    if (this.lifecycleState !== 'started') {
      throw new Error(`RuntimeGraphStore.${op} called before start()`);
    }
  }
}
