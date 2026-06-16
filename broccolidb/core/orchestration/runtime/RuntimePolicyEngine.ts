// [LAYER: CORE]
import { ApprovalPolicyEngine, PolicyBlockedError } from '../ApprovalPolicyEngine.js';
import { AgentGitError } from '../../errors.js';
import type { MutationPlan } from '../types.js';
import type { AssertExecutionInput, RuntimeMode, RuntimeModeConfig } from './types.js';
import { MODE_CONFIGS } from './types.js';

export class RuntimePolicyViolationError extends AgentGitError {
  constructor(message: string, public readonly reasons: string[]) {
    super(message, 'INVARIANT_VIOLATION');
    this.name = 'RuntimePolicyViolationError';
  }
}

const SAFE_DIRECTIVES = new Set([
  'UPDATE_IMPORT_PATH',
  'REMOVE_STALE_IMPORT',
  'RESYNC_DISK_PARITY',
  'REFRESH_GRAPH_NODE',
]);

export class RuntimePolicyEngine extends ApprovalPolicyEngine {
  getModeConfig(mode: RuntimeMode): RuntimeModeConfig {
    return MODE_CONFIGS[mode];
  }

  defaultPolicyForMode(mode: RuntimeMode) {
    return MODE_CONFIGS[mode].defaultPolicy;
  }

  assertExecutionAllowed(input: AssertExecutionInput): void {
    const config = MODE_CONFIGS[input.mode];
    const reasons: string[] = [];

    if (config.allowedDirectives === 'none') {
      reasons.push(`runtime mode '${input.mode}' forbids all directives`);
    } else if (config.allowedDirectives === 'safe-only') {
      for (const step of input.plan.steps) {
        if (!SAFE_DIRECTIVES.has(step.type)) {
          reasons.push(`directive type '${step.type}' not allowed in mode '${input.mode}'`);
        }
      }
    }

    if (input.plan.steps.length > input.budget.maxDirectives) {
      reasons.push('plan exceeds session budget maxDirectives');
    }

    if (input.plan.affectedFiles.length > input.budget.maxFilesTouched) {
      reasons.push('plan exceeds session budget maxFilesTouched');
    }

    if (reasons.length > 0) {
      throw new RuntimePolicyViolationError(
        `Runtime policy violation: ${reasons.join('; ')}`,
        reasons
      );
    }

    try {
      this.assertAllowed(input.plan, input.policy, input.approvedBy);
    } catch (error) {
      if (error instanceof PolicyBlockedError) {
        throw new RuntimePolicyViolationError(error.message, error.decision.reasons);
      }
      throw error;
    }
  }

  isMutationAllowed(mode: RuntimeMode): boolean {
    return MODE_CONFIGS[mode].allowedDirectives !== 'none';
  }
}
