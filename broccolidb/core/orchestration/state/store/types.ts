// [LAYER: CORE]
import type { RuntimeMode } from '../../runtime/types.js';
import type { GraphEdge, GraphNode } from '../types.js';

export const RUNTIME_GRAPH_SCHEMA_VERSION = '29.0.0';

export type ReplayMode = 'timeline' | 'forensic' | 'verification' | 'causal' | 'ci';

export type RuntimeGraphDiagnosticId =
  | 'RTG-001'
  | 'RTG-002'
  | 'RTG-003'
  | 'RTG-004'
  | 'RTG-005'
  | 'RTG-006'
  | 'RTG-007'
  | 'RTG-008';

export const RTG_LABELS: Record<RuntimeGraphDiagnosticId, string> = {
  'RTG-001': 'OrphanedNode',
  'RTG-002': 'DanglingEdge',
  'RTG-003': 'InvalidExecutionChain',
  'RTG-004': 'ReplayDivergence',
  'RTG-005': 'SnapshotCorruption',
  'RTG-006': 'InvalidRollbackLink',
  'RTG-007': 'IncompleteVerification',
  'RTG-008': 'RuntimeTruthMismatch',
};

export interface RuntimeSnapshot {
  snapshotId: string;
  sessionId?: string;
  createdAt: number;
  runtimeVersion: string;
  graphHash: string;
  nodeCount: number;
  edgeCount: number;
  mode: RuntimeMode;
  compressed: boolean;
  rootNodes: string[];
  blobHash: string;
  metadata?: Record<string, unknown>;
}

export interface SerializedRuntimeGraph {
  schemaVersion: string;
  sessionId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphHash: string;
  compacted?: boolean;
  compactionSummary?: string;
}

export interface IntegrityViolation {
  diagnosticId: RuntimeGraphDiagnosticId;
  message: string;
  nodeId?: string;
  edgeId?: string;
  sessionId?: string;
}

export interface IntegrityReport {
  healthy: boolean;
  violations: IntegrityViolation[];
  checkedAt: number;
}

export interface RuntimeMemoryHealth {
  graphIntegrity: 'healthy' | 'degraded' | 'corrupted';
  snapshotCount: number;
  replayableSessions: number;
  orphanedNodes: number;
  danglingEdges: number;
  compactionRatio: number;
  integrityViolations: number;
  lastIntegrityCheck?: number;
  lastSuccessfulSnapshot?: number;
  migrationStatus?: string;
}

export interface ReplayHydrationResult {
  sessionId: string;
  mode: ReplayMode;
  readonly: true;
  snapshot?: RuntimeSnapshot;
  graph: SerializedRuntimeGraph;
  integrity: IntegrityReport;
  divergenceDetected: boolean;
}

export interface RuntimeStory {
  sessionId: string;
  narrative: string;
  whatHappened: string[];
  why: string[];
  whatChanged: string[];
  whatFailed: string[];
  whatRecovered: string[];
  whatRemainsBlocked: string[];
  generatedAt: number;
}

export interface ReplayOptions {
  mode?: ReplayMode;
  snapshotId?: string;
}

export interface CompactionResult {
  sessionId: string;
  beforeNodes: number;
  afterNodes: number;
  snapshotId: string;
  replayable: true;
}
