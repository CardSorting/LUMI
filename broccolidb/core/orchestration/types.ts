// [LAYER: CORE]
import type { CapabilityIntent, IntentPriority } from '../agent-context/intent-types.js';
import type { ExecutionBudget, PartialExecutionBudget, RuntimeEvent, RuntimeMode } from './runtime/types.js';
import type {
  RepairDirective,
  RepairRiskLevel,
  SpiderFinding,
  SpiderGateResult,
  SpiderReport,
  SpiderReportDiff,
} from '../policy/spider/report-types.js';

export type ApprovalPolicy =
  | 'readonly'
  | 'autonomous_safe'
  | 'human_approval_required'
  | 'ci_gate_only'
  | 'recovery_mode'
  | 'production_locked';

export type ExecutionSessionStatus =
  | 'running'
  | 'blocked'
  | 'awaiting_approval'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface MutationStep {
  stepId: string;
  directiveId: string;
  type: RepairDirective['type'];
  targetFile: string;
  description: string;
  riskLevel: RepairRiskLevel;
  verificationCommand?: string;
}

export interface RollbackStrategy {
  kind: 'file-snapshot' | 'graph-refresh' | 'none';
  snapshotIds: string[];
  description: string;
}

export interface MutationPlan {
  planId: string;
  sessionId: string;
  correlationId?: string;
  createdAt: number;
  steps: MutationStep[];
  estimatedRisk: RepairRiskLevel;
  affectedFiles: string[];
  rollbackStrategy: RollbackStrategy;
  requiredVerificationCommands: string[];
  requiredApprovals: ApprovalPolicy[];
  expectedInvariantChanges: string[];
  sourceReportId: string;
  directives: RepairDirective[];
}

export interface RepairExecution {
  executionId: string;
  planId: string;
  sessionId: string;
  startedAt: number;
  finishedAt?: number;
  appliedSteps: string[];
  skippedSteps: string[];
  snapshotIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
  error?: string;
}

export interface VerificationResult {
  verificationId: string;
  sessionId: string;
  executionId: string;
  passed: boolean;
  introducedFindings: SpiderFinding[];
  resolvedFindings: SpiderFinding[];
  remainingFindings: SpiderFinding[];
  driftStatus: 'clean' | 'drifted';
  gateStatus: 'pass' | 'fail';
  invariantViolations: string[];
  diff?: SpiderReportDiff | null;
  gate?: SpiderGateResult;
  verifiedAt: number;
}

export interface ExecutionSession {
  sessionId: string;
  startedAt: number;
  agentId?: string;
  taskId?: string;
  correlationId?: string;
  priority?: IntentPriority;
  budget?: PartialExecutionBudget;
  runtimeMode?: RuntimeMode;

  intents: CapabilityIntent[];
  audits: SpiderReport[];
  repairPlans: MutationPlan[];
  executions: RepairExecution[];
  verifications: VerificationResult[];

  status: ExecutionSessionStatus;
  failureReason?: string;
}

export type ExecutionTraceEventKind =
  | 'session_started'
  | 'session_completed'
  | 'session_failed'
  | 'session_rolled_back'
  | 'audit_recorded'
  | 'plan_created'
  | 'approval_granted'
  | 'approval_denied'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'verification_started'
  | 'verification_completed'
  | 'rollback_started'
  | 'rollback_completed';

export interface ExecutionTraceEvent {
  eventId: string;
  sessionId: string;
  correlationId?: string;
  intentId?: string;
  kind: ExecutionTraceEventKind;
  timestamp: number;
  detail: Record<string, unknown>;
}

export interface RuntimeHealth {
  status: 'healthy' | 'degraded' | 'critical';
  activeSessions: number;
  queuedSessions: number;
  failedSessions: number;
  rollbackCount: number;
  verificationFailures: number;
  averageExecutionLatencyMs: number;
  averageVerificationLatencyMs: number;
  pendingApprovals: number;
  concurrencyUtilization: number;
  budgetViolations: number;
  policyViolations: number;
  runtimeMode: RuntimeMode;
  recentCriticalEvents: RuntimeEvent[];
}

export type { ExecutionBudget, PartialExecutionBudget, RuntimeMode, RuntimeEvent, ReplayResult } from './runtime/types.js';

export interface BeginSessionInput {
  taskId?: string;
  agentId?: string;
  correlationId?: string;
  priority?: IntentPriority;
  budget?: PartialExecutionBudget;
}

export interface PlanRepairsInput {
  audit: SpiderReport;
  policy?: ApprovalPolicy;
  sessionId: string;
  correlationId?: string;
}

export interface PlanPreview {
  plan: MutationPlan;
  policyDecision: PolicyDecision;
  narrative: string;
}

export interface PolicyDecision {
  allowed: boolean;
  policy: ApprovalPolicy;
  reasons: string[];
  requiredApprovals: ApprovalPolicy[];
}

export interface ExecutePlanInput {
  plan: MutationPlan;
  sessionId?: string;
  policy?: ApprovalPolicy;
  approvedBy?: string;
  priority?: IntentPriority;
}

export interface ExecutePlanResult {
  execution: RepairExecution;
  session: ExecutionSession;
}

export interface VerifyExecutionInput {
  execution: RepairExecution;
  sessionId: string;
  baselineReport?: SpiderReport;
}

export interface FileSnapshot {
  snapshotId: string;
  filePath: string;
  content: string;
  capturedAt: number;
}
