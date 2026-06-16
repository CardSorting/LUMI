// [LAYER: CORE]
/**
 * BroccoliDB v30 — frozen public API surface.
 * @stable Do not add exports here without updating API_STABILITY.md and public-api-snapshot.test.ts
 */

// Agent entry
export { AgentContext } from './agent-context.js';

// Lifecycle & errors
export {
  AgentGitError,
  LifecycleStateError,
  InvariantViolationError,
  RecoveryError,
  StorageIntegrityError,
  BackpressureError,
  DatabaseLockError,
} from './errors.js';
export type { AgentGitErrorCode } from './errors.js';
export { GuidedError, formatGuidance, type ErrorGuidance } from './error-guidance.js';

// Capabilities (types)
export type * from './agent-context/capability-types.js';
export type { CapabilityHealth } from './agent-context/capability-health.js';

// Intent tracing
export type * from './agent-context/intent-types.js';
export { IntentTracer } from './agent-context/IntentTracer.js';

// Health & context types
export type {
  BroccoliDbHealth,
  BroccoliDbCacheStats,
  AgentProfile,
} from './agent-context/types.js';

// Runtime (orchestration) — stable operator surface
export { OrchestrationRuntime } from './orchestration/OrchestrationRuntime.js';
export type {
  ExecutionSession,
  ExecutionSessionStatus,
  MutationPlan,
  MutationStep,
  RepairExecution,
  VerificationResult,
  RuntimeHealth,
  ApprovalPolicy,
  ExecutionBudget,
  BeginSessionInput,
  ExecutePlanInput,
  VerifyExecutionInput,
} from './orchestration/types.js';
export type {
  RuntimeSessionState,
  RuntimeBlocker,
  RuntimeNextAction,
  RuntimeExportOptions,
  RuntimeExportResult,
} from './orchestration/state/types.js';
export type {
  RuntimeSnapshot,
  RuntimeStory,
  RuntimeMemoryHealth,
  ReplayMode,
  ReplayOptions,
  ReplayHydrationResult,
} from './orchestration/state/store/types.js';
export type { RuntimeMode } from './orchestration/runtime/types.js';

// Policy errors agents may catch
export { PolicyBlockedError } from './orchestration/ApprovalPolicyEngine.js';
export { RuntimePolicyViolationError, RuntimeBudgetExceededError } from './orchestration/runtime/index.js';

// Workspace bootstrap (common for scripts)
export { Workspace } from './workspace.js';
export { Connection } from './connection.js';
