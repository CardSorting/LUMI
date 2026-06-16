// [LAYER: CORE]
import { AgentGitError } from '../errors.js';
import type { MutationPlan, ApprovalPolicy, PolicyDecision } from './types.js';

export class PolicyBlockedError extends AgentGitError {
  constructor(message: string, public readonly decision: PolicyDecision) {
    super(message, 'INVARIANT_VIOLATION');
    this.name = 'PolicyBlockedError';
  }
}

const RISK_ORDER = { low: 0, medium: 1, high: 2 } as const;

export class ApprovalPolicyEngine {
  assertAllowed(plan: MutationPlan, policy: ApprovalPolicy, approvedBy?: string): PolicyDecision {
    const decision = this.evaluate(plan, policy, approvedBy);
    if (!decision.allowed) {
      throw new PolicyBlockedError(
        `Mutation plan blocked by policy '${policy}': ${decision.reasons.join('; ')}`,
        decision
      );
    }
    return decision;
  }

  evaluate(plan: MutationPlan, policy: ApprovalPolicy, approvedBy?: string): PolicyDecision {
    const reasons: string[] = [];
    const requiredApprovals = [...plan.requiredApprovals];

    switch (policy) {
      case 'readonly':
        return {
          allowed: false,
          policy,
          reasons: ['readonly policy forbids all mutations'],
          requiredApprovals,
        };

      case 'production_locked':
        return {
          allowed: false,
          policy,
          reasons: ['production_locked policy forbids autonomous mutation'],
          requiredApprovals,
        };

      case 'human_approval_required':
        if (!approvedBy) {
          return {
            allowed: false,
            policy,
            reasons: ['human approval required before execution'],
            requiredApprovals: ['human_approval_required', ...requiredApprovals],
          };
        }
        break;

      case 'ci_gate_only':
        if (!plan.requiredVerificationCommands.some((c) => c.includes('gate') || c.includes('check'))) {
          reasons.push('ci_gate_only requires gate verification commands in plan');
        }
        break;

      case 'recovery_mode':
        break;

      case 'autonomous_safe':
        if (RISK_ORDER[plan.estimatedRisk] > RISK_ORDER.low) {
          reasons.push(`autonomous_safe blocks plans with risk '${plan.estimatedRisk}'`);
        }
        if (plan.steps.some((s) => s.riskLevel === 'high')) {
          reasons.push('autonomous_safe blocks high-risk steps');
        }
        break;
    }

    if (plan.steps.length === 0) {
      reasons.push('empty mutation plan');
    }

    return {
      allowed: reasons.length === 0,
      policy,
      reasons,
      requiredApprovals,
    };
  }

  requiredPolicyForRisk(risk: MutationPlan['estimatedRisk']): ApprovalPolicy[] {
    if (risk === 'high') return ['human_approval_required'];
    if (risk === 'medium') return ['ci_gate_only'];
    return ['autonomous_safe'];
  }
}
