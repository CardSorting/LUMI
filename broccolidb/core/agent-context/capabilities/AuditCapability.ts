// [LAYER: CORE]
// @classification CAPABILITY
import type { AuditService } from '../AuditService.js';
import type { InvariantEngine } from '../InvariantEngine.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  type AuditConstitutionalCheckInput,
  type AuditConstitutionalCheckResult,
  type AuditInvariantsResult,
  type AuditLogicalConstraintInput,
  type AuditLogicalConstraintResult,
  type AuditLogicalConstraintsResult,
  type AuditSpeculateImpactInput,
  type AuditSpeculateImpactResult,
} from '../capability-types.js';

export class AuditCapability extends CapabilityBase {
  readonly name = 'audit';
  readonly dependencies = ['InvariantEngine', 'AuditService'] as const;

  constructor(
    private readonly invariantEngine: InvariantEngine,
    private readonly auditService: AuditService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async invariants(): Promise<AuditInvariantsResult> {
    return this.execute('invariants', async () => ({
      violations: await this.invariantEngine.auditInvariants(),
    }));
  }

  async speculateImpact(input: AuditSpeculateImpactInput): Promise<AuditSpeculateImpactResult> {
    return this.execute('speculateImpact', async () => {
      const kbId = requireNonEmptyString(input.kbId, 'kbId');
      return this.auditService.predictEffect(input.fallbackId ?? kbId);
    });
  }

  async addLogicalConstraint(input: AuditLogicalConstraintInput): Promise<AuditLogicalConstraintResult> {
    return this.execute('addLogicalConstraint', async () => {
      await this.auditService.addLogicalConstraint(
        requireNonEmptyString(input.pathPattern, 'pathPattern'),
        requireNonEmptyString(input.knowledgeId, 'knowledgeId'),
        input.severity ?? 'blocking'
      );
      return { added: true };
    });
  }

  async getLogicalConstraints(): Promise<AuditLogicalConstraintsResult> {
    return this.execute('getLogicalConstraints', async () => ({
      constraints: await this.auditService.getLogicalConstraints(),
    }));
  }

  async checkConstitutionalViolation(
    input: AuditConstitutionalCheckInput
  ): Promise<AuditConstitutionalCheckResult> {
    return this.execute('checkConstitutionalViolation', async () =>
      this.auditService.checkConstitutionalViolation(
        requireNonEmptyString(input.path, 'path'),
        requireNonEmptyString(input.code, 'code'),
        requireNonEmptyString(input.ruleContent, 'ruleContent')
      )
    );
  }
}
