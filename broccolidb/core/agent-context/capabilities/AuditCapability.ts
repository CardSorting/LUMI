// [LAYER: CORE]
// @classification CAPABILITY
import type { AuditService } from '../AuditService.js';
import type { InvariantEngine } from '../InvariantEngine.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
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
  type AuditTracesInput,
  type AuditTracesResult,
  requirePositiveInt,
} from '../capability-types.js';

export class AuditCapability extends CapabilityBase {
  readonly name = 'audit' as const;
  readonly dependencies = ['InvariantEngine', 'AuditService', 'IntentTracer'] as const;

  constructor(
    private readonly invariantEngine: InvariantEngine,
    private readonly auditService: AuditService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async invariants(): Promise<AuditInvariantsResult> {
    return this.execute(
      'invariants',
      async () => ({
        violations: await this.invariantEngine.auditInvariants(),
      }),
      {
        inputSummary: {},
        expectedEffects: ['InvariantEngine.auditInvariants'],
        durability: 'ephemeral',
        summarizeResult: (result) => ({ violationCount: result.violations.length }),
      }
    );
  }

  async traces(input: AuditTracesInput = {}): Promise<AuditTracesResult> {
    const limit = requirePositiveInt(input.limit, 'limit', 20);
    return this.execute(
      'traces',
      async () => ({
        traces: this.intentTracer.recent(limit, {
          correlationId: input.correlationId,
        }),
      }),
      {
        input,
        inputSummary: { limit, correlationId: input.correlationId },
        expectedEffects: ['IntentTracer.recent'],
        durability: 'ephemeral',
        summarizeResult: (result) => ({ traceCount: result.traces.length }),
      }
    );
  }

  async speculateImpact(input: AuditSpeculateImpactInput): Promise<AuditSpeculateImpactResult> {
    return this.execute(
      'speculateImpact',
      async () => {
        const kbId = requireNonEmptyString(input.kbId, 'kbId');
        return this.auditService.predictEffect(input.fallbackId ?? kbId);
      },
      {
        input,
        inputSummary: { kbId: input.kbId, fallbackId: input.fallbackId },
        expectedEffects: ['AuditService.predictEffect'],
        summarizeResult: (result) => ({ isValid: result.isValid }),
      }
    );
  }

  async addLogicalConstraint(input: AuditLogicalConstraintInput): Promise<AuditLogicalConstraintResult> {
    return this.execute(
      'addLogicalConstraint',
      async () => {
        await this.auditService.addLogicalConstraint(
          requireNonEmptyString(input.pathPattern, 'pathPattern'),
          requireNonEmptyString(input.knowledgeId, 'knowledgeId'),
          input.severity ?? 'blocking'
        );
        return { added: true };
      },
      {
        input,
        inputSummary: {
          pathPattern: input.pathPattern,
          knowledgeId: input.knowledgeId,
          severity: input.severity ?? 'blocking',
        },
        expectedEffects: ['AuditService.addLogicalConstraint', 'BufferedDbPool.logical_constraints'],
        durability: 'durable',
      }
    );
  }

  async getLogicalConstraints(): Promise<AuditLogicalConstraintsResult> {
    return this.execute(
      'getLogicalConstraints',
      async () => ({
        constraints: await this.auditService.getLogicalConstraints(),
      }),
      {
        inputSummary: {},
        expectedEffects: ['AuditService.getLogicalConstraints'],
        durability: 'buffered',
        summarizeResult: (result) => ({ constraintCount: result.constraints.length }),
      }
    );
  }

  async checkConstitutionalViolation(
    input: AuditConstitutionalCheckInput
  ): Promise<AuditConstitutionalCheckResult> {
    return this.execute(
      'checkConstitutionalViolation',
      async () =>
        this.auditService.checkConstitutionalViolation(
          requireNonEmptyString(input.path, 'path'),
          requireNonEmptyString(input.code, 'code'),
          requireNonEmptyString(input.ruleContent, 'ruleContent')
        ),
      {
        input,
        inputSummary: { path: input.path },
        expectedEffects: ['AuditService.checkConstitutionalViolation'],
        durability: 'ephemeral',
        summarizeResult: (result) => ({ violated: result.violated }),
      }
    );
  }
}
