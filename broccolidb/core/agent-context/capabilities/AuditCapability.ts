// [LAYER: CORE]
// @classification CAPABILITY
import type { AuditService } from '../AuditService.js';
import type { InvariantEngine } from '../InvariantEngine.js';
import type { SpiderService } from '../SpiderService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
import type { SpiderAuditOptions, SpiderReport, SpiderResyncOptions, SpiderGateResult, SpiderAgentBundle, SpiderBundleBudget, SpiderCheckRequest, SpiderCheckResult, SpiderBundleWireFormat } from '../../policy/spider/report-types.js';
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
  readonly dependencies = ['InvariantEngine', 'AuditService', 'SpiderService', 'IntentTracer'] as const;

  constructor(
    private readonly invariantEngine: InvariantEngine,
    private readonly auditService: AuditService,
    private readonly spiderService: SpiderService,
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

  /**
   * Structural forensic audit — alternate entry aligned with GraphCapability.spider.
   * Use when the agent is already in an audit workflow.
   */
  get spider() {
    const summarize = (result: SpiderReport) => ({
      verdict: result.verdict,
      passed: result.passed,
      blockers: result.agentDigest?.blockers.length ?? 0,
    });
    return {
      audit: (options?: SpiderAuditOptions) =>
        this.execute('spider.audit', () => this.spiderService.audit(options), {
          input: options,
          expectedEffects: ['SpiderService.audit'],
          durability: 'ephemeral',
          summarizeResult: summarize,
        }),
      gate: (options?: SpiderAuditOptions) =>
        this.execute('spider.gate', () => this.spiderService.gate(options), {
          input: options,
          expectedEffects: ['SpiderService.gate'],
          durability: 'ephemeral',
          summarizeResult: (r: SpiderGateResult) => ({
            conclusion: r.conclusion,
            blocked: r.blocked,
            exitCode: r.exitCode,
          }),
        }),
      gateBundle: (options?: SpiderAuditOptions) =>
        this.execute('spider.gateBundle', () => this.spiderService.gateBundle(options), {
          input: options,
          expectedEffects: ['SpiderService.gateBundle'],
          durability: 'ephemeral',
          summarizeResult: (r) => ({
            proceed: r.bundle.proceed,
            exitCode: r.gate.exitCode,
            brief: r.bundle.brief,
          }),
        }),
      check: (request: SpiderCheckRequest) =>
        this.execute('spider.check', () => this.spiderService.check(request), {
          input: request,
          expectedEffects: ['SpiderService.check'],
          durability: 'ephemeral',
          summarizeResult: (r: SpiderCheckResult) => ({
            phase: r.phase,
            proceed: r.proceed,
            exitCode: r.exitCode,
            workflowSteps: r.workflow?.length ?? 0,
          }),
        }),
      handoff: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget) =>
        this.run('spider.handoff', () => this.spiderService.handoff(bundle, budget)),
      outputSchema: () => this.run('spider.outputSchema', () => this.spiderService.getOutputSchema()),
      serializeBundle: (bundle: SpiderAgentBundle, agentContext?: string, workflowSummary?: string) =>
        this.run('spider.serializeBundle', () =>
          this.spiderService.serializeBundle(bundle, agentContext, workflowSummary)
        ),
      parseBundleWire: (data: unknown) => this.run('spider.parseBundleWire', () => this.spiderService.parseBundleWire(data)),
      validateWire: (wire: unknown) => this.run('spider.validateWire', () => this.spiderService.validateWire(wire)),
      formatWireDigest: (wire: SpiderBundleWireFormat, maxCompactLines?: number) =>
        this.run('spider.formatWireDigest', () => this.spiderService.formatWireDigest(wire, maxCompactLines)),
      formatCheckDigest: (result: SpiderCheckResult, maxCompactLines?: number) =>
        this.run('spider.formatCheckDigest', () => this.spiderService.formatCheckDigest(result, maxCompactLines)),
      toCheckResponse: (
        result: SpiderCheckResult,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.run('spider.toCheckResponse', () => this.spiderService.toCheckResponse(result, options)),
      assertCheckPassed: (result: SpiderCheckResult, message?: string) =>
        this.run('spider.assertCheckPassed', () => this.spiderService.assertCheckPassed(result, message)),
      getCheckOutputSchema: () => this.run('spider.getCheckOutputSchema', () => this.spiderService.getCheckOutputSchema()),
      prepareSarifUpload: (report: SpiderReport) =>
        this.run('spider.prepareSarifUpload', () => this.spiderService.prepareSarifUpload(report)),
      buildDiagnosticSummary: (report: SpiderReport) =>
        this.run('spider.buildDiagnosticSummary', () => this.spiderService.buildDiagnosticSummary(report)),
      validateCheck: (result: unknown) => this.run('spider.validateCheck', () => this.spiderService.validateCheck(result)),
      toStructuredTelemetry: (wire: SpiderBundleWireFormat) =>
        this.run('spider.toStructuredTelemetry', () => this.spiderService.toStructuredTelemetry(wire)),
      bundle: (report: SpiderReport) =>
        this.run('spider.bundle', () => this.spiderService.toAgentBundle(report)),
      batchPreflight: (filePaths: string[], options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute('spider.batchPreflight', () => this.spiderService.batchPreflight(filePaths, options), {
          input: { filePaths, ...options },
          expectedEffects: ['SpiderService.batchPreflight'],
          durability: 'ephemeral',
          summarizeResult: (r) => ({ proceed: r.proceed, files: r.files.length }),
        }),
      setBaseline: (report?: SpiderReport) =>
        this.run('spider.setBaseline', () => ({ reportId: this.spiderService.setBaseline(report) })),
      compareBaseline: (report?: SpiderReport) =>
        this.run('spider.compareBaseline', () => this.spiderService.compareToBaseline(report)),
      compareBaselineBundle: (report?: SpiderReport) =>
        this.run('spider.compareBaselineBundle', () => this.spiderService.compareBaselineBundle(report)),
      shouldProceed: (report: SpiderReport) =>
        this.run('spider.shouldProceed', () => this.spiderService.shouldProceed(report)),
      toolSchema: () => this.run('spider.toolSchema', () => this.spiderService.getAgentToolSchema()),
      resync: (options: SpiderResyncOptions) =>
        this.execute('spider.resync', () => this.spiderService.resync(options), {
          input: options,
          expectedEffects: ['SpiderService.resync'],
          durability: 'ephemeral',
        }),
      preflight: (filePath: string, options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute('spider.preflight', () => this.spiderService.preflight(filePath, options), {
          input: { filePath, ...options },
          expectedEffects: ['SpiderService.preflight'],
          durability: 'ephemeral',
          summarizeResult: (r) => summarize(r.audit),
        }),
      preflightBundle: (filePath: string, options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute('spider.preflightBundle', () => this.spiderService.preflightBundle(filePath, options), {
          input: { filePath, ...options },
          expectedEffects: ['SpiderService.preflightBundle'],
          durability: 'ephemeral',
          summarizeResult: (r) => ({ proceed: r.proceed, brief: r.bundle.brief }),
        }),
      sessionDelta: (report?: SpiderReport) =>
        this.run('spider.sessionDelta', () => this.spiderService.getSessionDelta(report)),
      agentContext: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget) =>
        this.run('spider.agentContext', () => this.spiderService.toAgentContext(bundle, budget)),
      compact: (report: SpiderReport) => this.run('spider.compact', () => this.spiderService.toCompact(report)),
      formatNarrative: (report: SpiderReport) =>
        this.run('spider.formatNarrative', () => this.spiderService.formatAgentNarrative(report)),
      explain: (report: SpiderReport, findingId: string) =>
        this.run('spider.explain', () => this.spiderService.explainFinding(report, findingId)),
      explainForAgent: (report: SpiderReport, findingId: string) =>
        this.run('spider.explainForAgent', () => this.spiderService.explainFindingForAgent(report, findingId)),
    };
  }
}
