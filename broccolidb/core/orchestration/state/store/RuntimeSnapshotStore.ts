// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type { BufferedDbPool } from '../../../../infrastructure/db/BufferedDbPool.js';
import type { StorageService } from '../../../../infrastructure/storage/StorageService.js';
import type { RuntimeMode } from '../../runtime/types.js';
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import { RuntimeGraphSerializer } from './RuntimeGraphSerializer.js';
import type { RuntimeSnapshot, SerializedRuntimeGraph } from './types.js';

export class RuntimeSnapshotStore {
  private readonly snapshots = new Map<string, RuntimeSnapshot>();
  private readonly serializedCache = new Map<string, SerializedRuntimeGraph>();
  private lastSuccessfulSnapshot?: number;

  constructor(
    private readonly serializer: RuntimeGraphSerializer,
    private readonly db?: BufferedDbPool,
    private readonly storage?: StorageService,
    private readonly userId?: string
  ) {}

  async save(
    graph: RuntimeStateGraph,
    sessionId: string,
    mode: RuntimeMode,
    options?: { compressed?: boolean; metadata?: Record<string, unknown> }
  ): Promise<RuntimeSnapshot> {
    const snap = graph.snapshot(sessionId);
    const serialized = this.serializer.serialize(sessionId, snap.nodes, snap.edges, {
      compacted: options?.compressed,
      compactionSummary: options?.metadata?.compactionSummary as string | undefined,
    });

    let blobHash = serialized.graphHash;
    if (this.storage) {
      blobHash = await this.storage.writeBlob(JSON.stringify(serialized));
    }

    const snapshot: RuntimeSnapshot = {
      snapshotId: randomUUID(),
      sessionId,
      createdAt: Date.now(),
      runtimeVersion: serialized.schemaVersion,
      graphHash: serialized.graphHash,
      nodeCount: snap.nodes.length,
      edgeCount: snap.edges.length,
      mode,
      compressed: options?.compressed ?? false,
      rootNodes: snap.nodes.filter((n) => n.kind === 'Session').map((n) => n.id),
      blobHash,
      metadata: options?.metadata,
    };

    this.snapshots.set(snapshot.snapshotId, snapshot);
    this.serializedCache.set(snapshot.snapshotId, serialized);
    this.lastSuccessfulSnapshot = snapshot.createdAt;

    if (this.db && this.userId) {
      await this.db.push({
        type: 'insert',
        table: 'audit_events',
        values: {
          id: snapshot.snapshotId,
          userId: this.userId,
          agentId: null,
          type: 'runtime_snapshot',
          data: JSON.stringify({ ...snapshot, serialized: !this.storage ? serialized : undefined }),
          createdAt: snapshot.createdAt,
        },
      });
    }

    return snapshot;
  }

  async load(snapshotId: string): Promise<{ snapshot: RuntimeSnapshot; graph: SerializedRuntimeGraph }> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    let graph: SerializedRuntimeGraph;
    const cached = this.serializedCache.get(snapshotId);
    if (cached) {
      graph = this.serializer.deserialize(cached);
    } else if (this.storage) {
      const blob = await this.storage.readBlob(snapshot.blobHash);
      if (!blob) {
        throw new Error('RTG-005 SnapshotCorruption: blob missing from CAS store');
      }
      graph = this.serializer.deserialize(blob.toString('utf8'));
    } else if (this.db && this.userId) {
      const rows = await this.db.selectWhere('audit_events', [{ column: 'id', value: snapshotId }]);
      const row = rows[0] as { data?: string } | undefined;
      if (!row?.data) throw new Error('RTG-005 SnapshotCorruption: audit record missing');
      const parsed = JSON.parse(row.data) as RuntimeSnapshot & { serialized?: SerializedRuntimeGraph };
      if (!parsed.serialized) throw new Error('RTG-005 SnapshotCorruption: inline graph missing');
      graph = this.serializer.deserialize(parsed.serialized);
    } else {
      throw new Error('No persistence backend available');
    }

    if (graph.graphHash !== snapshot.graphHash) {
      throw new Error('RTG-005 SnapshotCorruption: metadata hash mismatch');
    }

    return { snapshot, graph };
  }

  list(sessionId?: string): RuntimeSnapshot[] {
    const all = [...this.snapshots.values()];
    return sessionId ? all.filter((s) => s.sessionId === sessionId) : all;
  }

  getLastSuccessfulSnapshotTime(): number | undefined {
    return this.lastSuccessfulSnapshot;
  }

  get count(): number {
    return this.snapshots.size;
  }

  register(snapshot: RuntimeSnapshot): void {
    this.snapshots.set(snapshot.snapshotId, snapshot);
  }

  clear(): void {
    this.snapshots.clear();
    this.serializedCache.clear();
    this.lastSuccessfulSnapshot = undefined;
  }
}
