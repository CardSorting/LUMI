// [LAYER: CORE]
export { OrchestrationRuntime, type OrchestrationRuntimeDeps } from './OrchestrationRuntime.js';
export { MutationPlanner } from './MutationPlanner.js';
export { RepairExecutor, type SpiderResyncPort } from './RepairExecutor.js';
export { VerificationPipeline, type SpiderVerificationPort, type InvariantPort } from './VerificationPipeline.js';
export { ApprovalPolicyEngine, PolicyBlockedError } from './ApprovalPolicyEngine.js';
export { RollbackCoordinator } from './RollbackCoordinator.js';
export { ExecutionTrace } from './ExecutionTrace.js';
export type * from './types.js';
