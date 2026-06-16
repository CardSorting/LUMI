// [LAYER: CORE]
// @classification CAPABILITY
import type { AuditService } from '../AuditService.js';
import type { InvariantEngine } from '../InvariantEngine.js';
import type { ImpactReport } from '../types.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class AuditCapability {
  constructor(
    private readonly invariantEngine: InvariantEngine,
    private readonly auditService: AuditService,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('audit', this.isStarted(), ['InvariantEngine', 'AuditService']);
  }

  async invariants(): Promise<string[]> {
    this.assertOperational('audit.invariants');
    return this.invariantEngine.auditInvariants();
  }

  async speculateImpact(kbId: string, fallbackId?: string): Promise<ImpactReport> {
    this.assertOperational('audit.speculateImpact');
    return this.auditService.predictEffect(fallbackId ?? kbId);
  }

  async addLogicalConstraint(
    pathPattern: string,
    knowledgeId: string,
    severity: 'blocking' | 'warning' = 'blocking'
  ) {
    this.assertOperational('audit.addLogicalConstraint');
    return this.auditService.addLogicalConstraint(pathPattern, knowledgeId, severity);
  }

  async getLogicalConstraints() {
    this.assertOperational('audit.getLogicalConstraints');
    return this.auditService.getLogicalConstraints();
  }

  async checkConstitutionalViolation(path: string, code: string, ruleContent: string) {
    this.assertOperational('audit.checkConstitutionalViolation');
    return this.auditService.checkConstitutionalViolation(path, code, ruleContent);
  }
}
