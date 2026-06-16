// [LAYER: CORE]
// @classification PURE
import { AgentGitError } from '../errors.js';
import type {
  AgentBundle,
  AgentProfile,
  ContradictionReport,
  GraphEdge,
  ImpactReport,
  KnowledgeBaseItem,
  Pedigree,
  TaskContext,
  TaskItem,
  TraversalFilter,
} from './types.js';
import type { ToolCall, ToolExecutorOptions, ToolResult } from './StreamingToolExecutor.js';
import type { ToolDef } from './types.js';
import type { BroccoliDbRecoveryReport } from './types.js';
import type { MailboxMessage } from './MailboxService.js';
import type { CapabilityIntentFields } from './intent-types.js';

export type { CapabilityIntentFields } from './intent-types.js';
export type { AuditTracesInput, AuditTracesResult, IntentTrace, IntentTracerHealth } from './intent-types.js';

export function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new AgentGitError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
  }
  return trimmed;
}

export function requireHash(value: string, field: string): string {
  const trimmed = requireNonEmptyString(value, field);
  if (!/^[a-f0-9]{64}$/i.test(trimmed)) {
    throw new AgentGitError(`${field} must be a valid SHA-256 hash`, 'INVALID_ARGUMENT');
  }
  return trimmed.toLowerCase();
}

export function requirePositiveInt(value: number | undefined, field: string, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new AgentGitError(`${field} must be a positive integer`, 'INVALID_ARGUMENT');
  }
  return resolved;
}

export function requireRecoveryMode(mode: string): 'standard' {
  if (mode !== 'standard') {
    throw new AgentGitError(`Unsupported recovery mode: ${mode}`, 'INVALID_ARGUMENT');
  }
  return mode;
}

// ─── Storage ───
export interface StorageStoreInput extends CapabilityIntentFields {
  content: string;
  namespace?: string;
}

export interface StorageStoreResult {
  hash: string;
  namespace: string;
}

export interface StorageHydrateInput extends CapabilityIntentFields {
  hash: string;
}

export interface StorageHydrateResult {
  hash: string;
  content: string | null;
}

// ─── Telemetry ───
export interface TelemetryRecordInput {
  usage: { promptTokens: number; completionTokens: number; modelId?: string };
  agentId?: string;
  taskId?: string | null;
  repoPath?: string;
}

export interface TelemetryRecordResult {
  recorded: true;
  telemetryId: string;
}

// ─── Recovery ───
export interface RecoveryRecoverInput {
  mode: 'standard';
}

export type RecoveryRecoverResult = BroccoliDbRecoveryReport;

export interface RecoveryRetractResult {
  retracted: true;
}

export interface RecoveryReconstituteInput {
  digest: string;
}

export interface RecoveryReconstituteResult {
  hydratedCount: number;
}

export interface RecoveryGarbageCollectionResult {
  prunedFacts: number;
  prunedBlobs: number;
  prunedTaskOutputs: number;
}

export interface RecoveryEpistemicSunsettingInput {
  confidenceThreshold?: number;
}

export interface RecoveryEpistemicSunsettingResult {
  prunedCount: number;
}

export interface RecoveryMemorySynthesisResult {
  synthesized: true;
}

// ─── Audit ───
export interface AuditInvariantsResult {
  violations: string[];
}

export interface AuditSpeculateImpactInput {
  kbId: string;
  fallbackId?: string;
}

export type AuditSpeculateImpactResult = ImpactReport;

export interface AuditLogicalConstraintInput {
  pathPattern: string;
  knowledgeId: string;
  severity?: 'blocking' | 'warning';
}

export interface AuditLogicalConstraintResult {
  added: true;
}

export interface AuditLogicalConstraintsResult {
  constraints: { knowledgeId: string; pathPattern: string; severity: string }[];
}

export interface AuditConstitutionalCheckInput {
  path: string;
  code: string;
  ruleContent: string;
}

export interface AuditConstitutionalCheckResult {
  violated: boolean;
  reason?: string;
}

// ─── Coordination ───
export interface CoordinationRegisterTeammateInput {
  agentId: string;
}

export interface CoordinationRegisterTeammateResult {
  registered: true;
  agentId: string;
}

export interface CoordinationTeammatesResult {
  teammates: string[];
}

export interface CoordinationAcquireLockInput {
  resource: string;
}

export interface CoordinationAcquireLockResult {
  acquired: boolean;
  token: number | null;
}

export interface CoordinationReleaseLockInput {
  resource: string;
}

export interface CoordinationReleaseLockResult {
  released: true;
}

export interface CoordinationSpawnWorkerInput {
  description: string;
  prompt: string;
  subagentType?: 'worker' | 'researcher' | 'verifier';
  parentTaskId?: string;
}

export interface CoordinationSpawnWorkerResult {
  workerId: string;
}

export interface CoordinationSynthesizeWorkersInput {
  workerIds: string[];
}

export interface CoordinationSynthesizeWorkersResult {
  synthesis: string;
}

// ─── Query ───
export interface QuerySearchInput extends CapabilityIntentFields {
  text: string;
  tags?: string[];
  limit?: number;
  skipVerification?: boolean;
}

export interface QuerySearchResult {
  items: KnowledgeBaseItem[];
  total: number;
}

export interface QueryVerifyBatchInput {
  itemIds: string[];
}

export interface QueryVerifyBatchResult {
  results: Record<string, { isValid: boolean; confidence: number }>;
}

export interface QueryGlobalCentralityInput {
  limit?: number;
}

export interface QueryGlobalCentralityResult {
  hubs: { kbId: string; score: number }[];
}

export interface QueryAppendSharedMemoryInput {
  memory: string;
}

export interface QueryAppendSharedMemoryResult {
  appended: true;
}

export interface QueryDecayConfidenceInput {
  factor: number;
  olderThan: number | Date;
}

export interface QueryDecayConfidenceResult {
  decayedCount: number;
}

export interface QueryAgentBundleInput {
  agentId: string;
}

export interface QueryAgentBundleResult {
  bundle: AgentBundle;
}

export interface QueryTaskLookupInput {
  taskId: string;
}

export interface QueryTaskLookupResult {
  task: Record<string, unknown> | null;
}

export interface QueryExecuteToolsInput {
  calls: ToolCall[];
  tools: ToolDef[];
  options?: ToolExecutorOptions;
}

export interface QueryExecuteToolsResult {
  results: ToolResult[];
}

export interface QueryReembedResult {
  embeddedCount: number;
  skippedCount: number;
}

export interface QueryErgonomicsSnapshotResult {
  userId: string;
  workspaceId: string;
  workspacePath: string;
  teammates: string[];
  cache: { hits: number; misses: number; size: number };
  capabilities: string[];
  toolExecutionDefaults: {
    timeoutMs: number;
    maxParallelReads: number;
    mirrorFileChanges: boolean;
    failOnUnsafeMutationPath: boolean;
    forensicPreEditGate: boolean;
    failOnPreEditBlockers: boolean;
    failOnPostEditBlockers: boolean;
    recordAuditEvents: boolean;
  };
}

// ─── Snapshot ───
export interface SnapshotCreateInput {
  metadata?: Record<string, unknown>;
}

export interface SnapshotCreateResult {
  hash: string;
}

// ─── Graph ───
export interface GraphAddKnowledgeInput {
  kbId: string;
  type: KnowledgeBaseItem['type'];
  content: string;
  tags?: string[];
  edges?: GraphEdge[];
  embedding?: number[];
  confidence?: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphAddKnowledgeResult {
  kbId: string;
}

export interface GraphKnowledgeIdInput {
  kbId: string;
}

export interface GraphKnowledgeBatchInput {
  ids: string[];
}

export interface GraphKnowledgeBatchResult {
  items: KnowledgeBaseItem[];
}

export interface GraphKnowledgeResult {
  item: KnowledgeBaseItem;
}

export interface GraphUpdateKnowledgeInput {
  kbId: string;
  patch: Partial<KnowledgeBaseItem>;
}

export interface GraphUpdateKnowledgeResult {
  updated: true;
  kbId: string;
}

export interface GraphMergeKnowledgeInput {
  sourceId: string;
  targetId: string;
}

export interface GraphMergeKnowledgeResult {
  merged: true;
  sourceId: string;
  targetId: string;
}

export interface GraphTraverseInput {
  startId: string;
  maxDepth?: number;
  filter?: TraversalFilter;
}

export interface GraphTraverseResult {
  nodes: KnowledgeBaseItem[];
}

export interface GraphStructuralImpactInput {
  filePath: string;
}

export interface GraphStructuralImpactResult {
  summary: string;
  blastRadius: ReturnType<import('./StructuralDiscoveryService.js').StructuralDiscoveryService['getBlastRadius']>;
  deficiencies: ReturnType<import('./StructuralDiscoveryService.js').StructuralDiscoveryService['getDeficiencyReport']>;
}

export type {
  SpiderAuditOptions,
  SpiderReport,
  SpiderResyncOptions,
  SpiderPreflightResult,
  SpiderGateResult,
  SpiderGatePolicy,
  SpiderReportDiff,
  SpiderAgentBundle,
  SpiderBatchPreflightResult,
  SpiderBaselineComparison,
  SpiderCauseCluster,
  SpiderGateBundleResult,
  SpiderPreflightBundleResult,
  SpiderSessionDelta,
  SpiderBundleBudget,
  SpiderCodeAction,
  SpiderCheckRequest,
  SpiderCheckResult,
  SpiderCheckPipelineRequest,
  SpiderCheckPipelineResult,
  SpiderCheckResponse,
  SpiderScenarioRunResult,
  SpiderScenarioResponse,
  SpiderAgentFailureEnvelope,
  SpiderHandoffResult,
  SpiderBaselineBundleResult,
  SpiderPriorityItem,
  SpiderWorkflowStep,
  SpiderBundleWireFormat,
} from '../policy/spider/report-types.js';

export interface GraphAnnotateKnowledgeInput {
  targetId: string;
  annotation: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphAnnotateKnowledgeResult {
  annotationId: string;
  targetId: string;
}

// ─── Reasoning ───
export interface ReasoningContradictionsInput {
  startIds: string | string[];
  depth?: number;
}

export interface ReasoningContradictionsResult {
  reports: ContradictionReport[];
}

export interface ReasoningPedigreeInput {
  nodeId: string;
  maxDepth?: number;
}

export interface ReasoningPedigreeResult {
  pedigree: Pedigree;
}

export interface ReasoningNodeInput {
  nodeId: string;
}

export interface ReasoningNarrativePedigreeResult {
  narrative: string;
}

export interface ReasoningSovereigntyResult {
  isValid: boolean;
  metrics: Record<string, number | string | boolean | null>;
}

export interface ReasoningAutoDiscoverInput {
  nodeId: string;
  limit?: number;
}

export interface ReasoningAutoDiscoverResult {
  discovered: number;
  suggestions: string[];
}

export interface ReasoningLogicalSoundnessInput {
  nodeIds: string[];
}

export interface ReasoningLogicalSoundnessResult {
  soundness: number;
}

export interface ReasoningSelfHealResult {
  healed: true;
}

export interface ReasoningSkepticalAuditInput {
  nodeIds: string[];
}

export interface ReasoningSkepticalAuditResult {
  pass: boolean;
  risks: string[];
  confidence: number;
  narrative: string;
}

// ─── Task ───
export interface TaskRegisterAgentInput {
  agentId: string;
  name: string;
  role: string;
  permissions?: string[];
}

export interface TaskRegisterAgentResult {
  registered: true;
  agentId: string;
}

export interface TaskAgentInput {
  agentId: string;
}

export interface TaskAgentResult {
  profile: AgentProfile;
}

export interface TaskAppendMemoryInput {
  agentId: string;
  memory: string;
}

export interface TaskAppendMemoryResult {
  appended: true;
}

export interface TaskUpdateStatusInput {
  taskId: string;
  status: TaskItem['status'];
  result?: unknown;
}

export interface TaskUpdateStatusResult {
  updated: true;
  taskId: string;
}

export interface TaskSpawnInput {
  taskId: string;
  agentId: string;
  description: string;
  linkedKnowledgeIds?: string[];
}

export interface TaskSpawnResult {
  taskId: string;
}

export interface TaskContextInput {
  taskId: string;
}

export interface TaskContextResult {
  context: TaskContext;
}

export interface TaskScratchpadPathResult {
  path: string;
}

export interface TaskScratchpadContentInput {
  content: string;
}

export interface TaskScratchpadContentResult {
  content: string;
}

export interface TaskScratchpadUpdateResult {
  updated: true;
}

// ─── Scratchpad ───
export interface ScratchpadWriteInput {
  filename: string;
  content: string;
}

export interface ScratchpadWriteResult {
  path: string;
}

export interface ScratchpadReadInput {
  filename: string;
}

export interface ScratchpadReadResult {
  content: string | null;
}

export interface ScratchpadListResult {
  files: string[];
}

export interface ScratchpadClearResult {
  cleared: true;
}

// ─── Mailbox ───
export interface MailboxPostMessageInput {
  to: string;
  from: string;
  type: MailboxMessage['type'];
  payload: unknown;
}

export interface MailboxPostMessageResult {
  posted: true;
}

export interface MailboxPostStatusInput {
  agentId: string;
  status: string;
}

export interface MailboxPostStatusResult {
  posted: true;
}

export interface MailboxPollInboxInput {
  agentId: string;
}

export interface MailboxPollInboxResult {
  messages: MailboxMessage[];
}

export interface MailboxClearResult {
  cleared: true;
}
