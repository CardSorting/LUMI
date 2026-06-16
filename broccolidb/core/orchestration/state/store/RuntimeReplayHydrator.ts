// [LAYER: CORE]
import type { RuntimeStateGraph } from '../RuntimeStateGraph.js';
import type { RuntimeSnapshotStore } from './RuntimeSnapshotStore.js';
import { RuntimeGraphSerializer } from './RuntimeGraphSerializer.js';
import { RuntimeMigrationEngine } from './RuntimeMigrationEngine.js';
import { RuntimeIntegrityVerifier } from './RuntimeIntegrityVerifier.js';
import type {
  IntegrityReport,
  ReplayHydrationResult,
  ReplayMode,
  SerializedRuntimeGraph,
} from './types.js';

export class RuntimeReplayHydrator {
  constructor(
    private readonly snapshotStore: RuntimeSnapshotStore,
    private readonly serializer: RuntimeGraphSerializer,
    private readonly migration: RuntimeMigrationEngine,
    private readonly integrity: RuntimeIntegrityVerifier
  ) {}

  async hydrate(
    graph: RuntimeStateGraph,
    sessionId: string,
    options: { mode?: ReplayMode; snapshotId?: string; liveGraphHash?: string } = {}
  ): Promise<ReplayHydrationResult> {
    const mode = options.mode ?? 'forensic';
    let serialized: SerializedRuntimeGraph;
    let snapshot;

    if (options.snapshotId) {
      const loaded = await this.snapshotStore.load(options.snapshotId);
      snapshot = loaded.snapshot;
      serialized = this.migration.migrate(loaded.graph);
    } else {
      const snapshots = this.snapshotStore.list(sessionId);
      if (snapshots.length > 0) {
        const latest = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
        const loaded = await this.snapshotStore.load(latest.snapshotId);
        snapshot = loaded.snapshot;
        serialized = this.migration.migrate(loaded.graph);
      } else {
        const snap = graph.snapshot(sessionId);
        serialized = this.serializer.serialize(sessionId, snap.nodes, snap.edges);
      }
    }

    const readonlyGraph = structuredClone(serialized);
    const integrityReport = this.integrity.verify(graph, sessionId);

    let divergenceDetected = false;
    if (options.liveGraphHash && options.liveGraphHash !== serialized.graphHash) {
      divergenceDetected = true;
      integrityReport.violations.push({
        diagnosticId: 'RTG-004',
        message: 'Replay graph hash diverges from live graph',
        sessionId,
      });
      integrityReport.healthy = false;
    }

    return {
      sessionId,
      mode,
      readonly: true,
      snapshot,
      graph: readonlyGraph,
      integrity: integrityReport,
      divergenceDetected,
    };
  }

  projectForMode(result: ReplayHydrationResult): Record<string, unknown> {
    switch (result.mode) {
      case 'timeline':
        return {
          nodes: result.graph.nodes.sort((a, b) => a.timestamp - b.timestamp),
          edges: result.graph.edges.sort((a, b) => a.timestamp - b.timestamp),
        };
      case 'causal':
        return {
          failures: result.graph.nodes.filter((n) => String(n.label).startsWith('Failure:')),
          plans: result.graph.nodes.filter((n) => n.kind === 'MutationPlan'),
          executions: result.graph.nodes.filter((n) => n.kind === 'Execution'),
        };
      case 'verification':
        return {
          verifications: result.graph.nodes.filter((n) => n.kind === 'Verification'),
          findings: result.graph.nodes.filter((n) => n.kind === 'Finding'),
        };
      case 'ci':
        return {
          schemaVersion: result.graph.schemaVersion,
          graphHash: result.graph.graphHash,
          nodeCount: result.graph.nodes.length,
          integrity: result.integrity.healthy,
        };
      case 'forensic':
      default:
        return { graph: result.graph, integrity: result.integrity, readonly: true };
    }
  }
}
