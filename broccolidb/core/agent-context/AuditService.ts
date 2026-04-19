import * as crypto from 'node:crypto';
import { Logger } from '../../shared/services/Logger.js';
import type { GraphService } from './GraphService.js';
import type { ReasoningService } from './ReasoningService.js';
import type { ImpactReport, ServiceContext } from './types.js';

export class AuditService {
  constructor(
    private ctx: ServiceContext,
    private graph: GraphService,
    private reasoning: ReasoningService
  ) {}

  async checkConstitutionalViolation(
    path: string,
    code: string,
    ruleContent: string
  ): Promise<{ violated: boolean; reason?: string }> {
    if (!this.ctx.aiService?.isAvailable()) {
      return { violated: false };
    }

    // [Pillar 4] Structural Awareness: Check if this path is "load-bearing"
    const discovery = this.ctx.getStructuralImpact(path);
    const blastCount = discovery.blastRadius?.affectedNodes?.length ?? 0;
    
    if (discovery.deficiencies && discovery.deficiencies.length > 0) {
        Logger.warn(`[AuditService] 🚨 SYMBOLIC CONTRACT VIOLATIONS in ${path}:`);
        for (const def of discovery.deficiencies) {
            Logger.warn(`  - Blocked by deficiency in ${def.depId} at line ${def.line}`);
        }
    }

    if (blastCount > 10) {
      Logger.warn(`[AuditService] High Blast Radius detected for ${path}: ${blastCount} affected nodes. Escalating audit.`);
    }

    return this.ctx.aiService.auditCodeAgainstRule(path, code, ruleContent);
  }

  /**
   * Permission Delegation.
   * Absorbed from src/utils/swarm/leaderPermissionBridge.ts.
   */
  async requestDelegatedPermission(agentId: string, toolName: string, input: any): Promise<{ approved: boolean; reason?: string }> {
    console.log(`[AuditService] 🛡️ Permission Request from ${agentId} for ${toolName}. Escalating to Leader.`);
    
    // In this sovereign implementation, the Leader is the primary AgentContext.
    // For now, we auto-approve if the blast radius is low, otherwise we log a 'BLOCK'.
    const filePath = input.path || input.targetFile || input.SearchPath;
    if (filePath) {
        const discovery = this.ctx.getStructuralImpact(filePath);
        const blastCount = discovery?.blastRadius?.affectedNodes?.length ?? 0;
        if (blastCount > 15) {
            return { approved: false, reason: `Blast radius ${blastCount} affected nodes is too high for autonomous execution. Requires manual Leader approval.` };
        }
    }

    return { approved: true };
  }

  async predictEffect(kbId: string): Promise<ImpactReport> {
    await this.graph.getKnowledge(kbId);
    const contradictions = await this.reasoning.detectContradictions(kbId, 2);

    const isValid = contradictions.length === 0;
    const suggestions: string[] = [];

    if (!isValid) {
      suggestions.push(`Hypothesis ${kbId} contradicts ${contradictions.length} existing nodes.`);
      suggestions.push('Consider adjusting the hypothesis or providing more evidence.');
    } else {
      suggestions.push('No direct contradictions found in immediate neighborhood.');
    }

    return {
      isValid,
      contradictions,
      suggestions,
      soundnessDelta: isValid ? 0.05 : -0.2,
    };
  }

  async addLogicalConstraint(
    pathPattern: string,
    knowledgeId: string,
    severity: 'blocking' | 'warning' = 'blocking'
  ): Promise<void> {
    const id = crypto.randomUUID();
    await this.ctx.push({
      type: 'insert',
      table: 'logical_constraints',
      values: {
        id,
        knowledgeId,
        pathPattern,
        severity,
        repoPath: this.ctx.workspace.workspaceId,
      },
      layer: 'domain',
    });
  }

  async getLogicalConstraints(): Promise<
    { knowledgeId: string; pathPattern: string; severity: string }[]
  > {
    const rows = await this.ctx.db.selectWhere('logical_constraints', [
      { column: 'repoPath', value: this.ctx.workspace.workspaceId },
    ]);
    return rows.map((r) => ({
      knowledgeId: r.knowledgeId,
      pathPattern: r.pathPattern,
      severity: r.severity,
    }));
  }
}
