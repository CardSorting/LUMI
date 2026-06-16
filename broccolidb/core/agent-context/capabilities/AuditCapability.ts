// [LAYER: CORE]
// @classification CAPABILITY
import type { AuditService } from '../AuditService.js';
import type { InvariantEngine } from '../InvariantEngine.js';
import type { SpiderService } from '../SpiderService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import { buildSpiderInputSummary, summarizeSpiderIntentResult } from '../../policy/spider/AgentSpiderIntent.js';
import type { SpiderAgentScenario } from '../../policy/spider/AgentDecisionGuide.js';
import type { IntentTracer } from '../IntentTracer.js';
import type { SpiderAuditOptions, SpiderReport, SpiderResyncOptions, SpiderGateResult, SpiderAgentBundle, SpiderBundleBudget, SpiderCheckRequest, SpiderCheckResult, SpiderBundleWireFormat, SpiderCheckPipelineRequest, SpiderCheckPipelineResult, SpiderReportDiff, SpiderScenarioRunResult, SpiderScenarioResponse, SpiderCheckResponse, SpiderAgentFailureEnvelope } from '../../policy/spider/report-types.js';
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
    const spiderTrace = (operation: string, input?: unknown) => ({
      input,
      inputSummary: buildSpiderInputSummary(operation, input),
      expectedEffects: [`SpiderService.${operation}`],
      durability: 'ephemeral' as const,
      summarizeResult: (result: unknown) => summarizeSpiderIntentResult(operation, result),
    });
    const summarize = (result: SpiderReport) => ({
      verdict: result.verdict,
      passed: result.passed,
      blockers: result.agentDigest?.blockers.length ?? 0,
    });
    return {
      audit: (options?: SpiderAuditOptions) =>
        this.execute('spider.audit', () => this.spiderService.audit(options), {
          ...spiderTrace('audit', options),
          summarizeResult: summarize,
        }),
      gate: (options?: SpiderAuditOptions) =>
        this.execute('spider.gate', () => this.spiderService.gate(options), {
          ...spiderTrace('gate', options),
          summarizeResult: (r: SpiderGateResult) => ({
            conclusion: r.conclusion,
            blocked: r.blocked,
            exitCode: r.exitCode,
          }),
        }),
      gateBundle: (options?: SpiderAuditOptions) =>
        this.execute('spider.gateBundle', () => this.spiderService.gateBundle(options), {
          ...spiderTrace('gateBundle', options),
          summarizeResult: (r) => ({
            proceed: r.bundle.proceed,
            exitCode: r.gate.exitCode,
            brief: r.bundle.brief,
          }),
        }),
      check: (request: SpiderCheckRequest) =>
        this.execute('spider.check', () => this.spiderService.check(request), spiderTrace('check', request)),
      checkAndRespond: (
        request: SpiderCheckRequest,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) =>
        this.execute('spider.checkAndRespond', () => this.spiderService.checkAndRespond(request, options), spiderTrace('checkAndRespond', request)),
      runCheckPipeline: (
        request: SpiderCheckPipelineRequest,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) =>
        this.execute('spider.runCheckPipeline', () => this.spiderService.runCheckPipeline(request, options), spiderTrace('runCheckPipeline', request)),
      runAgentScenario: (
        scenario: SpiderAgentScenario,
        params?: {
          filePath?: string;
          filePaths?: string[];
          scope?: SpiderCheckRequest['scope'];
          correlationId?: string;
        },
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) =>
        this.execute(
          'spider.runAgentScenario',
          () => this.spiderService.runAgentScenario(scenario, params, options),
          spiderTrace('runAgentScenario', { scenario, ...params })
        ),
      runAgentScenarioAndRespond: (
        scenario: SpiderAgentScenario,
        params?: {
          filePath?: string;
          filePaths?: string[];
          scope?: SpiderCheckRequest['scope'];
          correlationId?: string;
        },
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) =>
        this.execute(
          'spider.runAgentScenarioAndRespond',
          () => this.spiderService.runAgentScenarioAndRespond(scenario, params, options),
          spiderTrace('runAgentScenarioAndRespond', { scenario, ...params })
        ),
      handoff: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget, options?: { phase?: SpiderCheckResult['phase'] }) =>
        this.run('spider.handoff', () => this.spiderService.handoff(bundle, budget, options)),
      handoffFromCheck: (result: SpiderCheckResult, budget?: SpiderBundleBudget) =>
        this.run('spider.handoffFromCheck', () => this.spiderService.handoffFromCheck(result, budget)),
      buildCiArtifacts: (result: SpiderCheckResult, options?: { includeSarifMeta?: boolean }) =>
        this.run('spider.buildCiArtifacts', () => this.spiderService.buildCiArtifacts(result, options)),
      buildScenarioCiArtifacts: (response: SpiderScenarioResponse, options?: { includeSchemaRegistry?: boolean }) =>
        this.run('spider.buildScenarioCiArtifacts', () => this.spiderService.buildScenarioCiArtifacts(response, options)),
      writeCiArtifacts: (outputDir: string, result: SpiderCheckResult, options?: { includeSarifMeta?: boolean }) =>
        this.execute('spider.writeCiArtifacts', () => this.spiderService.writeCiArtifacts(outputDir, result, options), spiderTrace('writeCiArtifacts', { outputDir })),
      writeScenarioCiArtifacts: (outputDir: string, response: SpiderScenarioResponse, options?: { includeSchemaRegistry?: boolean }) =>
        this.execute(
          'spider.writeScenarioCiArtifacts',
          () => this.spiderService.writeScenarioCiArtifacts(outputDir, response, options),
          spiderTrace('writeScenarioCiArtifacts', { outputDir, scenario: response.scenario })
        ),
      outputSchema: () => this.run('spider.outputSchema', () => this.spiderService.getOutputSchema()),
      serializeBundle: (bundle: SpiderAgentBundle, agentContext?: string, workflowSummary?: string) =>
        this.run('spider.serializeBundle', () =>
          this.spiderService.serializeBundle(bundle, agentContext, workflowSummary)
        ),
      parseBundleWire: (data: unknown) => this.run('spider.parseBundleWire', () => this.spiderService.parseBundleWire(data)),
      validateWire: (wire: unknown) => this.run('spider.validateWire', () => this.spiderService.validateWire(wire)),
      restoreFromWire: (wire: unknown, maxCompactLines?: number) =>
        this.run('spider.restoreFromWire', () => this.spiderService.restoreFromWire(wire, maxCompactLines), spiderTrace('restoreFromWire', { reportId: (wire as { reportId?: string })?.reportId })),
      validateWireRestore: (wire: unknown) =>
        this.run('spider.validateWireRestore', () => this.spiderService.validateWireRestore(wire)),
      getWireOutputSchema: () => this.run('spider.getWireOutputSchema', () => this.spiderService.getWireOutputSchema()),
      parseNdjsonStream: (stream: string) =>
        this.run('spider.parseNdjsonStream', () => this.spiderService.parseNdjsonStream(stream)),
      formatWireDigest: (wire: SpiderBundleWireFormat, maxCompactLines?: number) =>
        this.run('spider.formatWireDigest', () => this.spiderService.formatWireDigest(wire, maxCompactLines)),
      formatCheckDigest: (result: SpiderCheckResult, maxCompactLines?: number) =>
        this.run('spider.formatCheckDigest', () => this.spiderService.formatCheckDigest(result, maxCompactLines)),
      toCheckResponse: (
        result: SpiderCheckResult,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.run('spider.toCheckResponse', () => this.spiderService.toCheckResponse(result, options)),
      toScenarioResponse: (
        result: SpiderScenarioRunResult,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.run('spider.toScenarioResponse', () => this.spiderService.toScenarioResponse(result, options)),
      getScenarioOutputSchema: () => this.run('spider.getScenarioOutputSchema', () => this.spiderService.getScenarioOutputSchema()),
      assertCheckPassed: (result: SpiderCheckResult, message?: string) =>
        this.run('spider.assertCheckPassed', () => this.spiderService.assertCheckPassed(result, message)),
      assertScenarioPassed: (result: SpiderScenarioRunResult, message?: string) =>
        this.run('spider.assertScenarioPassed', () => this.spiderService.assertScenarioPassed(result, message)),
      validateScenario: (result: unknown) => this.run('spider.validateScenario', () => this.spiderService.validateScenario(result)),
      validateScenarioResponse: (response: unknown) =>
        this.run('spider.validateScenarioResponse', () => this.spiderService.validateScenarioResponse(response)),
      toScenarioNdjsonStream: (response: SpiderScenarioResponse) =>
        this.run('spider.toScenarioNdjsonStream', () => this.spiderService.toScenarioNdjsonStream(response)),
      parseScenarioNdjsonStream: (stream: string) =>
        this.run('spider.parseScenarioNdjsonStream', () => this.spiderService.parseScenarioNdjsonStream(stream)),
      formatScenarioFailure: (response: SpiderScenarioResponse) =>
        this.run('spider.formatScenarioFailure', () => this.spiderService.formatScenarioFailure(response)),
      formatCheckFailure: (response: SpiderCheckResponse) =>
        this.run('spider.formatCheckFailure', () => this.spiderService.formatCheckFailure(response)),
      formatPipelineFailure: (pipeline: SpiderCheckPipelineResult) =>
        this.run('spider.formatPipelineFailure', () => this.spiderService.formatPipelineFailure(pipeline)),
      getFailureOutputSchema: () => this.run('spider.getFailureOutputSchema', () => this.spiderService.getFailureOutputSchema()),
      formatFailureFromCheck: (
        result: SpiderCheckResult,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.run('spider.formatFailureFromCheck', () => this.spiderService.formatFailureFromCheck(result, options)),
      formatFailureFromScenario: (
        result: SpiderScenarioRunResult,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.run('spider.formatFailureFromScenario', () => this.spiderService.formatFailureFromScenario(result, options)),
      validateFailureEnvelope: (envelope: unknown) =>
        this.run('spider.validateFailureEnvelope', () => this.spiderService.validateFailureEnvelope(envelope)),
      safeValidateFailureEnvelope: (envelope: unknown) =>
        this.run('spider.safeValidateFailureEnvelope', () => this.spiderService.safeValidateFailureEnvelope(envelope)),
      isFailureEnvelope: (value: unknown) => this.run('spider.isFailureEnvelope', () => this.spiderService.isFailureEnvelope(value)),
      parseFailureJson: (json: string) => this.run('spider.parseFailureJson', () => this.spiderService.parseFailureJson(json)),
      assertCheckFailed: (result: SpiderCheckResult, message?: string) =>
        this.run('spider.assertCheckFailed', () => this.spiderService.assertCheckFailed(result, message)),
      assertScenarioFailed: (result: SpiderScenarioRunResult, message?: string) =>
        this.run('spider.assertScenarioFailed', () => this.spiderService.assertScenarioFailed(result, message)),
      validateCheckResponse: (response: unknown) =>
        this.run('spider.validateCheckResponse', () => this.spiderService.validateCheckResponse(response)),
      safeValidateCheckResponse: (response: unknown) =>
        this.run('spider.safeValidateCheckResponse', () => this.spiderService.safeValidateCheckResponse(response)),
      isCheckResponse: (value: unknown) => this.run('spider.isCheckResponse', () => this.spiderService.isCheckResponse(value)),
      parseCheckResponseJson: (json: string) =>
        this.run('spider.parseCheckResponseJson', () => this.spiderService.parseCheckResponseJson(json)),
      toFailureNdjsonStream: (envelope: SpiderAgentFailureEnvelope) =>
        this.run('spider.toFailureNdjsonStream', () => this.spiderService.toFailureNdjsonStream(envelope)),
      parseFailureNdjsonStream: (stream: string) =>
        this.run('spider.parseFailureNdjsonStream', () => this.spiderService.parseFailureNdjsonStream(stream)),
      toGithubCheckRunFromFailure: (envelope: SpiderAgentFailureEnvelope) =>
        this.run('spider.toGithubCheckRunFromFailure', () => this.spiderService.toGithubCheckRunFromFailure(envelope)),
      getAgentMethodGroups: () => this.run('spider.getAgentMethodGroups', () => this.spiderService.getAgentMethodGroups()),
      writeSchemaRegistry: (outputDir: string) =>
        this.execute('spider.writeSchemaRegistry', () => this.spiderService.writeSchemaRegistry(outputDir)),
      getCheckOutputSchema: () => this.run('spider.getCheckOutputSchema', () => this.spiderService.getCheckOutputSchema()),
      getCheckInputSchema: () => this.run('spider.getCheckInputSchema', () => this.spiderService.getCheckInputSchema()),
      getPipelineInputSchema: () => this.run('spider.getPipelineInputSchema', () => this.spiderService.getPipelineInputSchema()),
      getSchemaRegistry: () => this.run('spider.getSchemaRegistry', () => this.spiderService.getSchemaRegistry()),
      normalizeCheckRequest: (request: SpiderCheckRequest) =>
        this.run('spider.normalizeCheckRequest', () => this.spiderService.normalizeCheckRequest(request)),
      getAgentScenarios: () => this.run('spider.getAgentScenarios', () => this.spiderService.getAgentScenarios()),
      recommendCheckRequest: (
        scenario: 'before-edit' | 'after-edit' | 'ci-gate' | 'pr-review' | 'advisory-scan' | 'local-edit-loop',
        params?: { filePath?: string; filePaths?: string[]; scope?: SpiderCheckRequest['scope']; correlationId?: string }
      ) => this.run('spider.recommendCheckRequest', () => this.spiderService.recommendCheckRequest(scenario, params)),
      formatAgentDecisionGuide: () => this.run('spider.formatAgentDecisionGuide', () => this.spiderService.formatAgentDecisionGuide()),
      getWorkflowPresets: () => this.run('spider.getWorkflowPresets', () => this.spiderService.getWorkflowPresets()),
      safeValidateCheckRequest: (request: unknown) =>
        this.run('spider.safeValidateCheckRequest', () => this.spiderService.safeValidateCheckRequest(request)),
      validateCheckPipelineRequest: (request: unknown) =>
        this.run('spider.validateCheckPipelineRequest', () => this.spiderService.validateCheckPipelineRequest(request)),
      safeValidateCheckPipelineRequest: (request: unknown) =>
        this.run('spider.safeValidateCheckPipelineRequest', () => this.spiderService.safeValidateCheckPipelineRequest(request)),
      prepareSarifUpload: (report: SpiderReport) =>
        this.run('spider.prepareSarifUpload', () => this.spiderService.prepareSarifUpload(report)),
      buildDiagnosticSummary: (report: SpiderReport) =>
        this.run('spider.buildDiagnosticSummary', () => this.spiderService.buildDiagnosticSummary(report)),
      validateCheck: (result: unknown) => this.run('spider.validateCheck', () => this.spiderService.validateCheck(result)),
      toCheckNdjsonStream: (
        result: SpiderCheckResult,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.run('spider.toCheckNdjsonStream', () => this.spiderService.toCheckNdjsonStream(result, options)),
      toGithubCheckRun: (result: SpiderCheckResult, options?: { maxCompactLines?: number }) =>
        this.run('spider.toGithubCheckRun', () => this.spiderService.toGithubCheckRun(result, options)),
      getProblemMatcherConfig: () =>
        this.run('spider.getProblemMatcherConfig', () => this.spiderService.getProblemMatcherConfig()),
      toStructuredTelemetry: (wire: SpiderBundleWireFormat) =>
        this.run('spider.toStructuredTelemetry', () => this.spiderService.toStructuredTelemetry(wire)),
      formatPreflightDigest: (result: SpiderCheckResult, maxCompactLines?: number) =>
        this.run('spider.formatPreflightDigest', () => this.spiderService.formatPreflightDigest(result, maxCompactLines)),
      validateBundle: (bundle: SpiderAgentBundle) =>
        this.run('spider.validateBundle', () => {
          this.spiderService.validateBundle(bundle);
          return { valid: true, reportId: bundle.reportId };
        }),
      applyBundleBudget: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget) =>
        this.run('spider.applyBundleBudget', () => this.spiderService.applyBundleBudget(bundle, budget)),
      bundle: (report: SpiderReport) =>
        this.run('spider.bundle', () => this.spiderService.toAgentBundle(report)),
      batchPreflight: (filePaths: string[], options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute('spider.batchPreflight', () => this.spiderService.batchPreflight(filePaths, options), spiderTrace('batchPreflight', { filePaths, ...options })),
      setBaseline: (report?: SpiderReport) =>
        this.run('spider.setBaseline', () => ({ reportId: this.spiderService.setBaseline(report) })),
      compareBaseline: (report?: SpiderReport) =>
        this.run('spider.compareBaseline', () => this.spiderService.compareToBaseline(report)),
      compareBaselineBundle: (report?: SpiderReport) =>
        this.run('spider.compareBaselineBundle', () => this.spiderService.compareBaselineBundle(report)),
      shouldProceed: (report: SpiderReport) =>
        this.run('spider.shouldProceed', () => this.spiderService.shouldProceed(report)),
      toolSchema: () => this.run('spider.toolSchema', () => this.spiderService.getAgentToolSchema()),
      getAgentToolkitCatalog: () => this.run('spider.getAgentToolkitCatalog', () => this.spiderService.getAgentToolkitCatalog()),
      formatCatalogPrompt: () => this.run('spider.formatCatalogPrompt', () => this.spiderService.formatCatalogPrompt()),
      getAgentRunbook: () => this.run('spider.getAgentRunbook', () => this.spiderService.getAgentRunbook()),
      getMcpToolNames: () => this.run('spider.getMcpToolNames', () => this.spiderService.getMcpToolNames()),
      getGatePolicyPresets: () => this.run('spider.getGatePolicyPresets', () => this.spiderService.getGatePolicyPresets()),
      validateCheckRequest: (request: unknown) =>
        this.run('spider.validateCheckRequest', () => this.spiderService.validateCheckRequest(request)),
      resync: (options: SpiderResyncOptions) =>
        this.execute('spider.resync', () => this.spiderService.resync(options), spiderTrace('resync', options)),
      preflight: (filePath: string, options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute('spider.preflight', () => this.spiderService.preflight(filePath, options), {
          ...spiderTrace('preflight', { filePath, ...options }),
          summarizeResult: (r) => summarize(r.audit),
        }),
      preflightBundle: (filePath: string, options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute('spider.preflightBundle', () => this.spiderService.preflightBundle(filePath, options), spiderTrace('preflightBundle', { filePath, ...options })),
      sessionDelta: (report?: SpiderReport) =>
        this.run('spider.sessionDelta', () => this.spiderService.getSessionDelta(report)),
      agentContext: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget) =>
        this.run('spider.agentContext', () => this.spiderService.toAgentContext(bundle, budget)),
      compact: (report: SpiderReport) => this.run('spider.compact', () => this.spiderService.toCompact(report)),
      toSarif: (report: SpiderReport) => this.run('spider.toSarif', () => this.spiderService.toSarif(report)),
      toLspDiagnostics: (report: SpiderReport) =>
        this.run('spider.toLspDiagnostics', () => this.spiderService.toLspDiagnostics(report)),
      toDiagnosticJson: (report: SpiderReport) =>
        this.run('spider.toDiagnosticJson', () => this.spiderService.toDiagnosticJson(report)),
      toGithubAnnotations: (report: SpiderReport) =>
        this.run('spider.toGithubAnnotations', () => this.spiderService.toGithubAnnotations(report)),
      toTap: (report: SpiderReport) => this.run('spider.toTap', () => this.spiderService.toTap(report)),
      toJUnitXml: (report: SpiderReport, suiteName?: string) =>
        this.run('spider.toJUnitXml', () => this.spiderService.toJUnitXml(report, suiteName)),
      toNdjson: (report: SpiderReport) => this.run('spider.toNdjson', () => this.spiderService.toNdjson(report)),
      formatDiffNarrative: (diff: SpiderReportDiff) =>
        this.run('spider.formatDiffNarrative', () => this.spiderService.formatDiffNarrative(diff)),
      diffSinceLast: (report?: SpiderReport) =>
        this.run('spider.diffSinceLast', () => this.spiderService.diffSinceLast(report)),
      diff: (before: SpiderReport, after: SpiderReport) =>
        this.run('spider.diff', () => this.spiderService.diffReports(before, after)),
      formatNarrative: (report: SpiderReport) =>
        this.run('spider.formatNarrative', () => this.spiderService.formatAgentNarrative(report)),
      explain: (report: SpiderReport, findingId: string) =>
        this.run('spider.explain', () => this.spiderService.explainFinding(report, findingId)),
      explainForAgent: (report: SpiderReport, findingId: string) =>
        this.run('spider.explainForAgent', () => this.spiderService.explainFindingForAgent(report, findingId)),
    };
  }
}
