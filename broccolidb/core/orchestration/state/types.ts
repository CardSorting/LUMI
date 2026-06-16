// [LAYER: CORE]
import type { CapabilityIntent } from '../../agent-context/intent-types.js';
import type {
  ApprovalPolicy,
  ExecutionSession,
  ExecutionSessionStatus,
  MutationPlan,
  PolicyDecision,
  RepairExecution,
  RuntimeHealth,
  VerificationResult,
} from '../types.js';
import type { RuntimeEvent, RuntimeMode } from '../runtime/types.js';
import type {
  RepairDirective,
  SpiderFinding,
  SpiderReport,
  SpiderReportDiff,
} from '../../policy/spider/report-types.js';

export type GraphNodeKind =
  | 'Intent'
  | 'Session'
  | 'Audit'
  | 'Finding'
  | 'RepairDirective'
  | 'MutationPlan'
  | 'ApprovalDecision'
  | 'Execution'
  | 'Verification'
  | 'Rollback'
  | 'Replay'
  | 'RuntimeEvent'
  | 'HealthSnapshot'
  | 'BudgetViolation'
  | 'PolicyViolation'
  | 'Gate';

export type GraphEdgeKind =
  | 'created'
  | 'triggered'
  | 'blocked_by'
  | 'approved_by'
  | 'executed_by'
  | 'verified_by'
  | 'rolled_back_by'
  | 'introduced'
  | 'resolved'
  | 'failed_due_to'
  | 'replayed_from'
  | 'belongs_to_session';

export type FailureCause =
  | 'gate_blocked'
  | 'execution_failed'
  | 'verification_failed'
  | 'budget_exceeded'
  | 'policy_violation'
  | 'rollback_failed'
  | 'approval_required'
  | 'open_blockers';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  sessionId: string;
  timestamp: number;
  label: string;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStateGraphSnapshot {
  sessionId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: number;
}

export interface RuntimeSessionState {
  sessionId: string;
  status: ExecutionSessionStatus;
  runtimeMode: RuntimeMode;
  taskId?: string;
  agentId?: string;
  startedAt: number;
  failureCause?: FailureCause;
  failureReason?: string;
  success: boolean;
  graph: RuntimeStateGraphSnapshot;
  summary: {
    intentCount: number;
    auditCount: number;
    findingCount: number;
    planCount: number;
    executionCount: number;
    verificationCount: number;
    rollbackCount: number;
    openBlockerCount: number;
  };
}

export interface TimelineEntry {
  timestamp: number;
  kind: GraphNodeKind | GraphEdgeKind | 'gate_blocked';
  nodeId?: string;
  label: string;
  detail: Record<string, unknown>;
}

export interface RuntimeBlocker {
  blockerId: string;
  sessionId: string;
  kind: 'finding' | 'gate' | 'policy' | 'budget' | 'approval' | 'verification';
  severity: 'error' | 'warn' | 'info';
  message: string;
  cause: FailureCause;
  findingId?: string;
  filePath?: string;
  nextAction: RuntimeNextAction;
}

export interface RuntimeNextAction {
  actionId: string;
  label: string;
  command?: string;
  api?: string;
  requiresHumanApproval: boolean;
  allowedPolicies: ApprovalPolicy[];
}

export interface CausalChain {
  sessionId: string;
  chains: Array<{
    failure?: GraphNode;
    evidence?: GraphNode[];
    directive?: GraphNode;
    plan?: GraphNode;
    execution?: GraphNode;
    verification?: GraphNode;
    rollback?: GraphNode;
  }>;
}

export interface DiffView {
  sessionId: string;
  introduced: SpiderFinding[];
  resolved: SpiderFinding[];
  remaining: SpiderFinding[];
  diff?: SpiderReportDiff | null;
}

export interface OpenLoop {
  sessionId: string;
  status: ExecutionSessionStatus;
  loopKind: 'awaiting_approval' | 'verifying' | 'blocked' | 'running' | 'gate_open';
  message: string;
  since: number;
}

export interface RuntimeExplainResult {
  sessionId: string;
  narrative: string;
  status: ExecutionSessionStatus;
  success: boolean;
  failureCause?: FailureCause;
  causalSummary: string;
  blockerCount: number;
}

export type RuntimeExportFormat = 'json' | 'markdown' | 'sarif';

export interface RuntimeExportOptions {
  format: RuntimeExportFormat;
  includeGraph?: boolean;
}

export interface RuntimeExportResult {
  sessionId: string;
  format: RuntimeExportFormat;
  content: string;
}

export interface StateGraphContext {
  session: ExecutionSession;
  health: RuntimeHealth;
  runtimeMode: RuntimeMode;
  events: RuntimeEvent[];
}
