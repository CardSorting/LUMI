// [LAYER: CORE]
import type { IntentPriority } from '../../agent-context/intent-types.js';
import type {
  ApprovalPolicy,
  ExecutionSession,
  MutationPlan,
  RepairExecution,
  VerificationResult,
} from '../types.js';
import type { SpiderReport } from '../../policy/spider/report-types.js';

export type RuntimeMode =
  | 'development'
  | 'ci'
  | 'production'
  | 'readonly'
  | 'recovery'
  | 'forensic';

export interface ExecutionBudget {
  maxDurationMs: number;
  maxFilesTouched: number;
  maxDirectives: number;
  maxConcurrentExecutions: number;
  maxVerificationFailures: number;
  maxRollbackAttempts: number;
}

export type PartialExecutionBudget = Partial<ExecutionBudget>;

export interface SessionJournalEntry {
  entryId: string;
  sessionId: string;
  timestamp: number;
  kind: SessionJournalKind;
  payload: Record<string, unknown>;
}

export type SessionJournalKind =
  | 'session_started'
  | 'audit'
  | 'gate'
  | 'plan'
  | 'approval'
  | 'execution'
  | 'verification'
  | 'rollback'
  | 'failure'
  | 'completion'
  | 'budget_exceeded'
  | 'policy_violation';

export type RuntimeEvent =
  | { kind: 'SessionStarted'; sessionId: string; taskId?: string; mode: RuntimeMode; timestamp: number }
  | { kind: 'AuditCompleted'; sessionId: string; reportId: string; timestamp: number }
  | { kind: 'GateBlocked'; sessionId: string; exitCode: number; timestamp: number }
  | { kind: 'PlanGenerated'; sessionId: string; planId: string; stepCount: number; timestamp: number }
  | { kind: 'ExecutionStarted'; sessionId: string; executionId: string; planId: string; timestamp: number }
  | { kind: 'ExecutionSucceeded'; sessionId: string; executionId: string; timestamp: number }
  | { kind: 'ExecutionFailed'; sessionId: string; executionId?: string; error: string; timestamp: number }
  | { kind: 'VerificationSucceeded'; sessionId: string; verificationId: string; timestamp: number }
  | { kind: 'VerificationFailed'; sessionId: string; verificationId: string; timestamp: number }
  | { kind: 'RollbackStarted'; sessionId: string; snapshotCount: number; timestamp: number }
  | { kind: 'RollbackCompleted'; sessionId: string; restored: string[]; timestamp: number }
  | { kind: 'BudgetExceeded'; sessionId: string; reason: string; timestamp: number }
  | { kind: 'PolicyViolation'; sessionId: string; reasons: string[]; timestamp: number };

export interface RuntimeHealthV27 {
  status: 'healthy' | 'degraded' | 'critical';
  activeSessions: number;
  queuedSessions: number;
  failedSessions: number;
  rollbackCount: number;
  averageExecutionLatencyMs: number;
  averageVerificationLatencyMs: number;
  concurrencyUtilization: number;
  budgetViolations: number;
  policyViolations: number;
  runtimeMode: RuntimeMode;
  pendingApprovals: number;
  verificationFailures: number;
  recentCriticalEvents: RuntimeEvent[];
}

export interface ReplayResult {
  sessionId: string;
  mode: RuntimeMode;
  readonly: true;
  session: ExecutionSession;
  journal: SessionJournalEntry[];
  events: RuntimeEvent[];
  traces: Array<{ kind: string; timestamp: number; detail: Record<string, unknown> }>;
}

export interface ScheduledJob {
  jobId: string;
  sessionId: string;
  priority: IntentPriority;
  enqueuedAt: number;
  kind: 'execute';
  plan: MutationPlan;
  policy: ApprovalPolicy;
  approvedBy?: string;
}

export interface RuntimeModeConfig {
  defaultPolicy: ApprovalPolicy;
  defaultBudget: ExecutionBudget;
  allowedDirectives: 'all' | 'safe-only' | 'none';
  maxConcurrentExecutions: number;
  allowRetries: boolean;
  verificationStrict: boolean;
  telemetryDurable: boolean;
}

export interface AssertExecutionInput {
  mode: RuntimeMode;
  plan: MutationPlan;
  session: ExecutionSession;
  budget: ExecutionBudget;
  policy: ApprovalPolicy;
  approvedBy?: string;
}

export interface BudgetCheckInput {
  session: ExecutionSession;
  budget: ExecutionBudget;
  plan: MutationPlan;
}

export const DEFAULT_BUDGETS: Record<RuntimeMode, ExecutionBudget> = {
  development: {
    maxDurationMs: 120_000,
    maxFilesTouched: 20,
    maxDirectives: 30,
    maxConcurrentExecutions: 2,
    maxVerificationFailures: 3,
    maxRollbackAttempts: 3,
  },
  ci: {
    maxDurationMs: 60_000,
    maxFilesTouched: 10,
    maxDirectives: 15,
    maxConcurrentExecutions: 1,
    maxVerificationFailures: 1,
    maxRollbackAttempts: 2,
  },
  production: {
    maxDurationMs: 30_000,
    maxFilesTouched: 5,
    maxDirectives: 10,
    maxConcurrentExecutions: 1,
    maxVerificationFailures: 0,
    maxRollbackAttempts: 1,
  },
  readonly: {
    maxDurationMs: 300_000,
    maxFilesTouched: 0,
    maxDirectives: 0,
    maxConcurrentExecutions: 0,
    maxVerificationFailures: 0,
    maxRollbackAttempts: 0,
  },
  recovery: {
    maxDurationMs: 180_000,
    maxFilesTouched: 15,
    maxDirectives: 20,
    maxConcurrentExecutions: 1,
    maxVerificationFailures: 2,
    maxRollbackAttempts: 5,
  },
  forensic: {
    maxDurationMs: 600_000,
    maxFilesTouched: 0,
    maxDirectives: 0,
    maxConcurrentExecutions: 0,
    maxVerificationFailures: 0,
    maxRollbackAttempts: 0,
  },
};

export const MODE_CONFIGS: Record<RuntimeMode, RuntimeModeConfig> = {
  development: {
    defaultPolicy: 'autonomous_safe',
    defaultBudget: DEFAULT_BUDGETS.development,
    allowedDirectives: 'all',
    maxConcurrentExecutions: 2,
    allowRetries: false,
    verificationStrict: false,
    telemetryDurable: false,
  },
  ci: {
    defaultPolicy: 'ci_gate_only',
    defaultBudget: DEFAULT_BUDGETS.ci,
    allowedDirectives: 'safe-only',
    maxConcurrentExecutions: 1,
    allowRetries: false,
    verificationStrict: true,
    telemetryDurable: true,
  },
  production: {
    defaultPolicy: 'human_approval_required',
    defaultBudget: DEFAULT_BUDGETS.production,
    allowedDirectives: 'safe-only',
    maxConcurrentExecutions: 1,
    allowRetries: false,
    verificationStrict: true,
    telemetryDurable: true,
  },
  readonly: {
    defaultPolicy: 'readonly',
    defaultBudget: DEFAULT_BUDGETS.readonly,
    allowedDirectives: 'none',
    maxConcurrentExecutions: 0,
    allowRetries: false,
    verificationStrict: true,
    telemetryDurable: true,
  },
  recovery: {
    defaultPolicy: 'recovery_mode',
    defaultBudget: DEFAULT_BUDGETS.recovery,
    allowedDirectives: 'all',
    maxConcurrentExecutions: 1,
    allowRetries: false,
    verificationStrict: false,
    telemetryDurable: true,
  },
  forensic: {
    defaultPolicy: 'readonly',
    defaultBudget: DEFAULT_BUDGETS.forensic,
    allowedDirectives: 'none',
    maxConcurrentExecutions: 0,
    allowRetries: false,
    verificationStrict: true,
    telemetryDurable: true,
  },
};
