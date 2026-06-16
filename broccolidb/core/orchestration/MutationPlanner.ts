// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type { RepairDirective, RepairRiskLevel, SpiderReport } from '../policy/spider/report-types.js';
import type { ApprovalPolicy, MutationPlan, MutationStep } from './types.js';
import { ApprovalPolicyEngine } from './ApprovalPolicyEngine.js';

const RISK_ORDER: Record<RepairRiskLevel, number> = { low: 0, medium: 1, high: 2 };

function maxRisk(levels: RepairRiskLevel[]): RepairRiskLevel {
  if (levels.length === 0) return 'low';
  return levels.reduce((max, r) => (RISK_ORDER[r] > RISK_ORDER[max] ? r : max), 'low' as RepairRiskLevel);
}

function stepFromDirective(directive: RepairDirective): MutationStep {
  return {
    stepId: randomUUID(),
    directiveId: directive.directiveId,
    type: directive.type,
    targetFile: directive.targetFile,
    description: directive.rationale,
    riskLevel: directive.riskLevel,
    verificationCommand: directive.verificationCommand,
  };
}

export class MutationPlanner {
  constructor(private readonly policyEngine = new ApprovalPolicyEngine()) {}

  planFromAudit(input: {
    audit: SpiderReport;
    sessionId: string;
    correlationId?: string;
    policy: ApprovalPolicy;
  }): MutationPlan {
    const directives = input.audit.repairDirectives ?? [];
    const steps = directives.map(stepFromDirective);
    const affectedFiles = [...new Set(directives.map((d) => d.targetFile))];
    const riskLevels = directives.map((d) => d.riskLevel);
    const estimatedRisk = maxRisk(riskLevels);
    const requiredApprovals = this.policyEngine.requiredPolicyForRisk(estimatedRisk);
    if (input.policy !== 'autonomous_safe' && !requiredApprovals.includes(input.policy)) {
      requiredApprovals.push(input.policy);
    }

    const verificationCommands = [
      ...new Set(
        directives
          .map((d) => d.verificationCommand)
          .filter((c): c is string => Boolean(c))
      ),
      'await ctx.graph.spider.gate({ scope: "changed-files" })',
    ];

    return {
      planId: randomUUID(),
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      createdAt: Date.now(),
      steps,
      estimatedRisk,
      affectedFiles,
      rollbackStrategy: {
        kind: affectedFiles.length > 0 ? 'file-snapshot' : 'none',
        snapshotIds: [],
        description:
          affectedFiles.length > 0
            ? `Snapshot ${affectedFiles.length} file(s) before mutation; restore on failure`
            : 'No file mutations planned',
      },
      requiredVerificationCommands: verificationCommands,
      requiredApprovals,
      expectedInvariantChanges: affectedFiles.map((f) => `file:${f}`),
      sourceReportId: input.audit.reportId,
      directives,
    };
  }

  preview(plan: MutationPlan, policy: ApprovalPolicy): { narrative: string; stepCount: number } {
    const lines = [
      `Plan ${plan.planId.slice(0, 8)} — ${plan.steps.length} step(s), risk: ${plan.estimatedRisk}`,
      `Affected: ${plan.affectedFiles.join(', ') || '(none)'}`,
      `Rollback: ${plan.rollbackStrategy.description}`,
      '',
      ...plan.steps.map((s, i) => `${i + 1}. [${s.type}] ${s.targetFile}: ${s.description}`),
    ];
    lines.push('', `Policy: ${policy}`, `Required approvals: ${plan.requiredApprovals.join(', ')}`);
    return { narrative: lines.join('\n'), stepCount: plan.steps.length };
  }
}
