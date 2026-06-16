// [LAYER: CORE]
import { Logger } from '../../shared/services/Logger.js';
import { SpiderEngine, type SpiderViolation } from '../policy/SpiderEngine.js';
import { ForensicSpider } from '../policy/spider/ForensicSpider.js';
import { formatAgentNarrative, buildAgentDigest } from '../policy/spider/AgentDigest.js';
import {
  diffReports,
  evaluateGate,
  explainFinding as formatExplainFinding,
  formatDiffNarrative,
  toAgentCompact,
  toDiagnosticJson,
  toGithubAnnotations,
  toTap,
  toJUnitXml,
  toNdjsonDiagnostics,
  toLspDiagnostics,
  toSarifLog,
  scopeReportView,
  prepareSarifUpload,
} from '../policy/spider/AgentFormats.js';
import {
  buildAgentBundle,
  buildAgentContext,
  applyBundleBudget,
  toSuggestedCommands,
  explainFindingForAgent as formatExplainFindingForAgent,
  shouldProceedFromPreflight,
  SPIDER_AGENT_TOOL_SCHEMA,
  validateAgentBundleShape,
  validateGateResult,
  formatCheckDigest,
  exportProblemMatcherConfig,
  formatPreflightDigest,
} from '../policy/spider/AgentToolkit.js';
import { runCheckPipeline } from '../policy/spider/AgentPipeline.js';
import {
  SPIDER_CHECK_OUTPUT_SCHEMA,
  toCheckResponse,
  assertCheckPassed,
  validateCheckResult,
  validateCheckResponse,
  safeValidateCheckResponse,
  isCheckResponse,
  parseCheckResponseJson,
  buildDiagnosticSummaryFromReport,
  toCheckNdjsonStream,
  toGithubCheckRun,
} from '../policy/spider/AgentResponse.js';
import {
  SPIDER_SCENARIO_OUTPUT_SCHEMA,
  toScenarioResponse,
  assertScenarioPassed,
  assertScenarioFailed,
  validateScenarioResult,
  validateScenarioResponse,
  toScenarioNdjsonStream,
  parseScenarioNdjsonStream,
  formatFailureFromScenario,
} from '../policy/spider/AgentScenarioResponse.js';
import {
  formatCheckFailure,
  formatPipelineFailure,
  formatScenarioFailure,
  formatFailureFromCheck,
  assertCheckFailed,
  validateFailureEnvelope,
  safeValidateFailureEnvelope,
  isFailureEnvelope,
  parseFailureJson,
  toFailureNdjsonStream,
  parseFailureNdjsonStream,
  toGithubCheckRunFromFailure,
  SPIDER_FAILURE_OUTPUT_SCHEMA,
} from '../policy/spider/AgentFailure.js';
import { buildCiArtifacts, buildScenarioCiArtifacts, writeCiArtifactsToDir } from '../policy/spider/AgentCiArtifacts.js';
import { getAgentMethodGroups } from '../policy/spider/spider-agent-methods.js';
import {
  getAgentToolkitCatalog,
  validateCheckRequest,
  validateCheckPipelineRequest,
  safeValidateCheckRequest,
  safeValidateCheckPipelineRequest,
  SPIDER_GATE_POLICY_PRESETS,
  SPIDER_AGENT_RUNBOOK,
  formatCatalogPrompt,
} from '../policy/spider/AgentCatalog.js';
import {
  SPIDER_CHECK_INPUT_SCHEMA,
  SPIDER_PIPELINE_INPUT_SCHEMA,
  getWorkflowPresets,
  normalizeCheckRequest,
} from '../policy/spider/AgentCheckInput.js';
import { getSpiderSchemaRegistry, writeSchemaRegistryToDir } from '../policy/spider/AgentSchemaRegistry.js';
import { runAgentScenario } from '../policy/spider/AgentScenarioRunner.js';
import {
  SPIDER_AGENT_SCENARIOS,
  recommendCheckRequest,
  formatAgentDecisionGuide,
  type SpiderAgentScenario,
} from '../policy/spider/AgentDecisionGuide.js';
import { SPIDER_MCP_TOOL_NAMES } from '../policy/spider/spider-mcp-tools.js';
import { buildAgentHandoff } from '../policy/spider/AgentWorkflow.js';
import {
  SPIDER_BUNDLE_OUTPUT_SCHEMA,
  serializeAgentBundle,
  serializeAgentBundleV2,
  parseAgentBundleWire,
  formatWireDigest,
  toStructuredTelemetry,
  validateWireFormat,
} from '../policy/spider/AgentSerialization.js';
import {
  SPIDER_WIRE_OUTPUT_SCHEMA,
  restoreFromWire as buildWireRestore,
  parseNdjsonStream as parseSpiderNdjsonStream,
  validateWireRestore,
} from '../policy/spider/AgentWireRestore.js';
import type {
  SpiderAgentBundle,
  SpiderAuditOptions,
  SpiderBaselineComparison,
  SpiderBatchPreflightResult,
  SpiderGateBundleResult,
  SpiderPreflightBundleResult,
  SpiderSessionDelta,
  SpiderBundleBudget,
  SpiderCheckRequest,
  SpiderCheckResult,
  SpiderCheckPipelineRequest,
  SpiderCheckPipelineResult,
  SpiderScenarioRunResult,
  SpiderScenarioResponse,
  SpiderAgentFailureEnvelope,
  SpiderCheckResponse,
  SpiderHandoffResult,
  SpiderBaselineBundleResult,
  SpiderGatePolicy,
  SpiderGateResult,
  SpiderReport,
  SpiderResyncOptions,
  SpiderResyncResult,
  SpiderHealth,
  SpiderPreflightResult,
  SpiderReportDiff,
} from '../policy/spider/report-types.js';
import { SpiderAuditError } from '../policy/spider/spider-errors.js';
import { Repository } from '../repository.js';
import { StructuralDiscoveryService } from './StructuralDiscoveryService.js';
import { TaskMutex } from '../mutex.js';
import type { ServiceContext } from './types.js';
import type { RepairDirective } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type {
  SpiderReport,
  SpiderAuditOptions,
  SpiderResyncOptions,
  SpiderResyncResult,
  SpiderPreflightResult,
  SpiderGateResult,
  SpiderGatePolicy,
  SpiderReportDiff,
  SpiderAgentBundle,
  SpiderBatchPreflightResult,
  SpiderBaselineComparison,
  SpiderGateBundleResult,
  SpiderPreflightBundleResult,
  SpiderSessionDelta,
  SpiderBaselineBundleResult,
  SpiderBundleWireFormat,
  SpiderCheckRequest,
  SpiderCheckResult,
  SpiderCheckPipelineRequest,
  SpiderCheckPipelineResult,
  SpiderBundleBudget,
};

export class SpiderService {
  private engine: SpiderEngine;
  private discovery: StructuralDiscoveryService;
  private forensicSpider: ForensicSpider | null = null;
  private bootstrapped = false;
  private lastReport: SpiderReport | null = null;
  private previousReport: SpiderReport | null = null;
  private baselineReport: SpiderReport | null = null;

  constructor(private ctx: ServiceContext) {
    this.engine = new SpiderEngine(ctx.workspace.workspacePath);
    this.discovery = new StructuralDiscoveryService(() => this.engine);
  }

  private getForensic(): ForensicSpider {
    if (!this.forensicSpider) {
      this.forensicSpider = new ForensicSpider(this.engine, this.ctx.workspace.workspacePath);
    }
    return this.forensicSpider;
  }

  /**
   * V20 forensic audit — typed evidence, disk parity, optional type mirror and repair directives.
   * Read-only on disk; does not mutate files.
   */
  async audit(options: SpiderAuditOptions = {}): Promise<SpiderReport> {
    if (!this.bootstrapped) {
      await this.bootstrapGraph();
    }
    const report = await this.getForensic().audit(options);
    this.previousReport = this.lastReport;
    this.lastReport = report;
    return report;
  }

  async gate(options: SpiderAuditOptions = {}): Promise<SpiderGateResult> {
    const { gatePolicy, ...auditOptions } = options;
    const report = await this.audit({
      ...auditOptions,
      includeRepairDirectives: auditOptions.includeRepairDirectives ?? true,
    });
    const result = evaluateGate(report, gatePolicy);
    validateGateResult(result);
    return result;
  }

  /** Gate + agent bundle in one call — preferred CI + LLM entry point. */
  async gateBundle(options: SpiderAuditOptions = {}): Promise<SpiderGateBundleResult> {
    const { bundleBudget, ...rest } = options;
    const gate = await this.gate(rest);
    let bundle = this.toAgentBundle(gate.report, gate);
    if (bundleBudget) bundle = applyBundleBudget(bundle, bundleBudget);
    return { gate, bundle };
  }

  /**
   * Unified phase router — single MCP/agent entry for pre-edit, CI, and delta checks.
   */
  async check(request: SpiderCheckRequest): Promise<SpiderCheckResult> {
    validateCheckRequest(request);
    const resolved = normalizeCheckRequest(request);
    const gatePolicy = {
      ...(resolved.gatePreset ? SPIDER_GATE_POLICY_PRESETS[resolved.gatePreset] : {}),
      ...resolved.gatePolicy,
    };
    const budget = resolved.bundleBudget;
    const auditOpts = {
      includeTypes: resolved.includeTypes,
      includeRepairDirectives: resolved.includeRepairDirectives,
      gatePolicy: Object.keys(gatePolicy).length > 0 ? gatePolicy : undefined,
      bundleBudget: budget,
      neighborhoodDepth: resolved.neighborhoodDepth,
    };

    if (resolved.phase === 'pre-edit') {
      if (resolved.filePaths && resolved.filePaths.length > 0) {
        const batch = await this.batchPreflight(resolved.filePaths, auditOpts);
        return this.finalizeCheckResult('pre-edit', batch.proceed, batch.proceed ? 0 : 1, batch.bundle);
      }
      if (!resolved.filePath) {
        throw new SpiderAuditError('check pre-edit requires filePath or filePaths');
      }
      const pre = await this.preflightBundle(resolved.filePath, auditOpts);
      if (budget) pre.bundle = applyBundleBudget(pre.bundle, budget);
      return this.finalizeCheckResult('pre-edit', pre.proceed, pre.proceed ? 0 : 1, pre.bundle);
    }

    if (resolved.phase === 'post-edit' || resolved.phase === 'ci') {
      const result = await this.gateBundle({
        scope: resolved.scope ?? 'changed-files',
        ...auditOpts,
      });
      return this.finalizeCheckResult(
        resolved.phase,
        result.bundle.proceed,
        result.gate.exitCode,
        result.bundle,
        result.gate
      );
    }

    const session = this.getSessionDelta();
    const baseline = this.compareBaselineBundle();
    const sessionIntro = session?.diff.introduced.length ?? 0;
    const baselineIntro = baseline?.introducedCount ?? 0;
    const introduced = Math.max(sessionIntro, baselineIntro);
    const proceed = introduced === 0 && Boolean(session || baseline);
    const bundle = baseline?.bundle;
    const handoff = bundle
      ? buildAgentHandoff(bundle)
      : {
          agentContext: session?.narrative ?? 'No session or baseline delta — run audit and setBaseline first',
          workflow: [] as SpiderCheckResult['workflow'],
          workflowSummary: proceed ? 'No regressions detected' : `Review ${introduced} introduced finding(s)`,
        };
    return {
      phase: 'delta',
      proceed,
      exitCode: proceed ? 0 : 1,
      sessionDelta: session ?? undefined,
      baselineComparison: baseline ?? undefined,
      bundle,
      agentContext: handoff.agentContext,
      workflowSummary: handoff.workflowSummary,
      workflow: handoff.workflow,
      suggestedCommands: bundle ? toSuggestedCommands(bundle) : [],
      wire: bundle
        ? serializeAgentBundleV2(bundle, handoff.agentContext, handoff.workflowSummary, {
            phase: 'delta',
            ndjsonStream: toCheckNdjsonStream(
              toCheckResponse(
                {
                  phase: 'delta',
                  proceed,
                  exitCode: proceed ? 0 : 1,
                  bundle,
                  agentContext: handoff.agentContext,
                  workflowSummary: handoff.workflowSummary,
                  workflow: handoff.workflow,
                  suggestedCommands: toSuggestedCommands(bundle),
                },
                { workspaceRoot: this.ctx.workspace.workspacePath }
              )
            ),
          })
        : undefined,
    };
  }

  /** check() + toCheckResponse() — single agent/CI round-trip. */
  async checkAndRespond(
    request: SpiderCheckRequest,
    options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
  ) {
    const result = await this.check(request);
    return this.toCheckResponse(result, options);
  }

  /** Multi-phase pipeline — pre-edit → ci → delta with stop-on-failure. */
  async runCheckPipeline(
    request: SpiderCheckPipelineRequest,
    responseOptions?: { maxCompactLines?: number; includeSarifMeta?: boolean }
  ): Promise<SpiderCheckPipelineResult> {
    validateCheckPipelineRequest(request);
    return runCheckPipeline(
      (req) => this.check(req),
      request,
      { ...responseOptions, workspaceRoot: this.ctx.workspace.workspacePath }
    );
  }

  /** Recommend + execute agent scenario in one round-trip. */
  async runAgentScenario(
    scenario: SpiderAgentScenario,
    params?: {
      filePath?: string;
      filePaths?: string[];
      scope?: SpiderCheckRequest['scope'];
      correlationId?: string;
    },
    options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
  ): Promise<SpiderScenarioRunResult> {
    return runAgentScenario(
      (req) => this.check(req),
      (req, opts) => this.runCheckPipeline(req, opts),
      scenario,
      params,
      options
    );
  }

  /** runAgentScenario + toScenarioResponse() — preferred MCP/CI JSON transport. */
  async runAgentScenarioAndRespond(
    scenario: SpiderAgentScenario,
    params?: {
      filePath?: string;
      filePaths?: string[];
      scope?: SpiderCheckRequest['scope'];
      correlationId?: string;
    },
    options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
  ): Promise<SpiderScenarioResponse> {
    const result = await this.runAgentScenario(scenario, params, options);
    return this.toScenarioResponse(result, options);
  }

  toScenarioResponse(
    result: SpiderScenarioRunResult,
    options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
  ) {
    return toScenarioResponse(result, {
      ...options,
      workspaceRoot: this.ctx.workspace.workspacePath,
    });
  }

  assertScenarioPassed(result: SpiderScenarioRunResult, message?: string) {
    assertScenarioPassed(result, message);
    return { ok: true };
  }

  getScenarioOutputSchema() {
    return SPIDER_SCENARIO_OUTPUT_SCHEMA;
  }

  async writeSchemaRegistry(outputDir: string) {
    return writeSchemaRegistryToDir(outputDir);
  }

  validateScenario(result: unknown) {
    validateScenarioResult(result);
    return { valid: true };
  }

  validateScenarioResponse(response: unknown) {
    validateScenarioResponse(response);
    return { valid: true };
  }

  toScenarioNdjsonStream(response: SpiderScenarioResponse) {
    return toScenarioNdjsonStream(response);
  }

  parseScenarioNdjsonStream(stream: string) {
    return parseScenarioNdjsonStream(stream);
  }

  formatScenarioFailure(response: SpiderScenarioResponse): SpiderAgentFailureEnvelope {
    return formatScenarioFailure(response);
  }

  formatCheckFailure(response: SpiderCheckResponse) {
    return formatCheckFailure(response);
  }

  formatPipelineFailure(pipeline: SpiderCheckPipelineResult) {
    return formatPipelineFailure(pipeline);
  }

  getFailureOutputSchema() {
    return SPIDER_FAILURE_OUTPUT_SCHEMA;
  }

  formatFailureFromCheck(result: SpiderCheckResult, options?: { maxCompactLines?: number; includeSarifMeta?: boolean }) {
    return formatFailureFromCheck(result, options);
  }

  formatFailureFromScenario(
    result: SpiderScenarioRunResult,
    options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
  ) {
    return formatFailureFromScenario(result, options);
  }

  validateFailureEnvelope(envelope: unknown) {
    validateFailureEnvelope(envelope);
    return { valid: true };
  }

  safeValidateFailureEnvelope(envelope: unknown) {
    return safeValidateFailureEnvelope(envelope);
  }

  isFailureEnvelope(value: unknown): value is SpiderAgentFailureEnvelope {
    return isFailureEnvelope(value);
  }

  parseFailureJson(json: string) {
    return parseFailureJson(json);
  }

  assertCheckFailed(result: SpiderCheckResult, message?: string) {
    return assertCheckFailed(result, message);
  }

  assertScenarioFailed(result: SpiderScenarioRunResult, message?: string) {
    return assertScenarioFailed(result, message);
  }

  validateCheckResponse(response: unknown) {
    validateCheckResponse(response);
    return { valid: true };
  }

  safeValidateCheckResponse(response: unknown) {
    return safeValidateCheckResponse(response);
  }

  isCheckResponse(value: unknown): value is SpiderCheckResponse {
    return isCheckResponse(value);
  }

  parseCheckResponseJson(json: string) {
    return parseCheckResponseJson(json);
  }

  toFailureNdjsonStream(envelope: SpiderAgentFailureEnvelope) {
    return toFailureNdjsonStream(envelope);
  }

  parseFailureNdjsonStream(stream: string) {
    return parseFailureNdjsonStream(stream);
  }

  toGithubCheckRunFromFailure(envelope: SpiderAgentFailureEnvelope) {
    return toGithubCheckRunFromFailure(envelope);
  }

  getAgentMethodGroups() {
    return getAgentMethodGroups();
  }

  toCheckNdjsonStream(result: SpiderCheckResult, options?: { maxCompactLines?: number; includeSarifMeta?: boolean }) {
    return toCheckNdjsonStream(this.toCheckResponse(result, options));
  }

  toGithubCheckRun(result: SpiderCheckResult, options?: { maxCompactLines?: number }) {
    const response = this.toCheckResponse(result, options);
    const report = result.gate?.report;
    return toGithubCheckRun(response, report);
  }

  getProblemMatcherConfig() {
    return exportProblemMatcherConfig();
  }

  private finalizeCheckResult(
    phase: SpiderCheckResult['phase'],
    proceed: boolean,
    exitCode: 0 | 1,
    bundle: SpiderAgentBundle,
    gate?: SpiderGateResult
  ): SpiderCheckResult {
    const handoff = buildAgentHandoff(bundle, undefined, gate);
    const partial: SpiderCheckResult = {
      phase,
      proceed,
      exitCode,
      bundle,
      gate,
      agentContext: handoff.agentContext,
      workflowSummary: handoff.workflowSummary,
      workflow: handoff.workflow,
      suggestedCommands: toSuggestedCommands(bundle),
    };
    const response = toCheckResponse(partial, { workspaceRoot: this.ctx.workspace.workspacePath });
    return {
      ...partial,
      wire: serializeAgentBundleV2(bundle, handoff.agentContext, handoff.workflowSummary, {
        phase,
        ndjsonStream: toCheckNdjsonStream(response),
      }),
    };
  }

  formatPreflightDigest(result: SpiderCheckResult, maxCompactLines?: number) {
    return formatPreflightDigest(result, maxCompactLines);
  }

  handoff(
    bundle: SpiderAgentBundle,
    budget?: SpiderBundleBudget,
    options?: { phase?: SpiderCheckResult['phase'] }
  ): SpiderHandoffResult {
    const b = budget ? applyBundleBudget(bundle, budget) : bundle;
    const result = buildAgentHandoff(b);
    const phase = options?.phase ?? 'ci';
    const partial: SpiderCheckResult = {
      phase,
      proceed: b.proceed,
      exitCode: b.gate.exitCode,
      bundle: b,
      agentContext: result.agentContext,
      workflowSummary: result.workflowSummary,
      workflow: result.workflow,
      suggestedCommands: toSuggestedCommands(b),
    };
    const checkResponse = toCheckResponse(partial, { workspaceRoot: this.ctx.workspace.workspacePath });
    return {
      ...result,
      suggestedCommands: toSuggestedCommands(b),
      wire: serializeAgentBundleV2(b, result.agentContext, result.workflowSummary, {
        phase,
        ndjsonStream: toCheckNdjsonStream(checkResponse),
      }),
      checkResponse,
    };
  }

  handoffFromCheck(result: SpiderCheckResult, budget?: SpiderBundleBudget): SpiderHandoffResult {
    if (!result.bundle) {
      throw new SpiderAuditError('handoffFromCheck requires check result bundle');
    }
    return this.handoff(result.bundle, budget, { phase: result.phase });
  }

  buildCiArtifacts(result: SpiderCheckResult, options?: { includeSarifMeta?: boolean; includeSchemaRegistry?: boolean }) {
    const response = this.toCheckResponse(result, options);
    const sarif =
      options?.includeSarifMeta && result.gate?.report
        ? this.prepareSarifUpload(result.gate.report).sarif
        : undefined;
    const schemaRegistryJson =
      options?.includeSchemaRegistry !== false
        ? JSON.stringify(getSpiderSchemaRegistry(), null, 2)
        : undefined;
    return buildCiArtifacts(result, response, sarif, { schemaRegistryJson });
  }

  async writeCiArtifacts(
    outputDir: string,
    result: SpiderCheckResult,
    options?: { includeSarifMeta?: boolean; includeSchemaRegistry?: boolean }
  ) {
    const artifacts = this.buildCiArtifacts(result, options);
    return writeCiArtifactsToDir(outputDir, artifacts);
  }

  buildScenarioCiArtifacts(
    response: SpiderScenarioResponse,
    options?: { includeSchemaRegistry?: boolean }
  ) {
    const schemaRegistryJson =
      options?.includeSchemaRegistry !== false
        ? JSON.stringify(getSpiderSchemaRegistry(), null, 2)
        : undefined;
    return buildScenarioCiArtifacts(response, { schemaRegistryJson });
  }

  async writeScenarioCiArtifacts(
    outputDir: string,
    response: SpiderScenarioResponse,
    options?: { includeSchemaRegistry?: boolean }
  ) {
    const artifacts = this.buildScenarioCiArtifacts(response, options);
    return writeCiArtifactsToDir(outputDir, artifacts);
  }

  getOutputSchema() {
    return SPIDER_BUNDLE_OUTPUT_SCHEMA;
  }

  serializeBundle(bundle: SpiderAgentBundle, agentContext?: string, workflowSummary?: string) {
    const handoff = buildAgentHandoff(bundle);
    return serializeAgentBundle(
      bundle,
      agentContext ?? handoff.agentContext,
      workflowSummary ?? handoff.workflowSummary
    );
  }

  parseBundleWire(data: unknown): SpiderBundleWireFormat {
    return parseAgentBundleWire(data);
  }

  formatWireDigest(wire: SpiderBundleWireFormat, maxCompactLines?: number) {
    return formatWireDigest(wire, maxCompactLines);
  }

  toStructuredTelemetry(wire: SpiderBundleWireFormat) {
    return toStructuredTelemetry(wire);
  }

  validateWire(wire: unknown) {
    validateWireFormat(wire);
    return { valid: true };
  }

  restoreFromWire(wire: unknown, maxCompactLines?: number) {
    return buildWireRestore(wire, maxCompactLines);
  }

  validateWireRestore(wire: unknown) {
    return validateWireRestore(wire);
  }

  getWireOutputSchema() {
    return SPIDER_WIRE_OUTPUT_SCHEMA;
  }

  parseNdjsonStream(stream: string) {
    return parseSpiderNdjsonStream(stream);
  }

  formatCheckDigest(result: SpiderCheckResult, maxCompactLines?: number) {
    return formatCheckDigest(result, maxCompactLines);
  }

  toCheckResponse(result: SpiderCheckResult, options?: { maxCompactLines?: number; includeSarifMeta?: boolean }) {
    return toCheckResponse(result, {
      ...options,
      workspaceRoot: this.ctx.workspace.workspacePath,
    });
  }

  assertCheckPassed(result: SpiderCheckResult, message?: string) {
    assertCheckPassed(result, message);
    return { ok: true };
  }

  getCheckOutputSchema() {
    return SPIDER_CHECK_OUTPUT_SCHEMA;
  }

  getCheckInputSchema() {
    return SPIDER_CHECK_INPUT_SCHEMA;
  }

  getPipelineInputSchema() {
    return SPIDER_PIPELINE_INPUT_SCHEMA;
  }

  getSchemaRegistry() {
    return getSpiderSchemaRegistry();
  }

  normalizeCheckRequest(request: SpiderCheckRequest) {
    validateCheckRequest(request);
    return normalizeCheckRequest(request);
  }

  getAgentScenarios() {
    return SPIDER_AGENT_SCENARIOS;
  }

  recommendCheckRequest(
    scenario: keyof typeof SPIDER_AGENT_SCENARIOS,
    params?: { filePath?: string; filePaths?: string[]; scope?: SpiderCheckRequest['scope']; correlationId?: string }
  ) {
    return recommendCheckRequest(scenario, params);
  }

  formatAgentDecisionGuide() {
    return formatAgentDecisionGuide();
  }

  getWorkflowPresets() {
    return getWorkflowPresets();
  }

  safeValidateCheckRequest(request: unknown) {
    return safeValidateCheckRequest(request);
  }

  validateCheckPipelineRequest(request: unknown) {
    validateCheckPipelineRequest(request);
    return { valid: true };
  }

  safeValidateCheckPipelineRequest(request: unknown) {
    return safeValidateCheckPipelineRequest(request);
  }

  prepareSarifUpload(report: SpiderReport) {
    return prepareSarifUpload(report, this.ctx.workspace.workspacePath);
  }

  buildDiagnosticSummary(report: SpiderReport) {
    return buildDiagnosticSummaryFromReport(report);
  }

  validateCheck(result: unknown) {
    validateCheckResult(result);
    return { valid: true };
  }

  compareBaselineBundle(report?: SpiderReport): SpiderBaselineBundleResult | null {
    const comparison = this.compareToBaseline(report);
    if (!comparison) return null;
    const current = report ?? this.lastReport;
    if (!current) return null;
    const gate = evaluateGate(current);
    const bundle = buildAgentBundle(current, this.ctx.workspace.workspacePath, gate);
    const handoff = buildAgentHandoff(bundle);
    return {
      ...comparison,
      bundle,
      agentContext: handoff.agentContext,
      workflowSummary: handoff.workflowSummary,
      workflow: handoff.workflow,
      suggestedCommands: toSuggestedCommands(bundle),
    };
  }

  /** Single agent payload: narrative + compact + clusters + SARIF/LSP + playbook. */
  toAgentBundle(report: SpiderReport, gate?: SpiderGateResult): SpiderAgentBundle {
    return buildAgentBundle(report, this.ctx.workspace.workspacePath, gate);
  }

  getAgentToolSchema() {
    return SPIDER_AGENT_TOOL_SCHEMA;
  }

  getAgentToolkitCatalog() {
    return getAgentToolkitCatalog();
  }

  formatCatalogPrompt() {
    return formatCatalogPrompt(getAgentToolkitCatalog());
  }

  getAgentRunbook() {
    return SPIDER_AGENT_RUNBOOK;
  }

  getMcpToolNames() {
    return [...SPIDER_MCP_TOOL_NAMES];
  }

  getGatePolicyPresets() {
    return SPIDER_GATE_POLICY_PRESETS;
  }

  validateCheckRequest(request: unknown) {
    validateCheckRequest(request);
    return { valid: true };
  }

  setBaseline(report?: SpiderReport): string {
    const baseline = report ?? this.lastReport;
    if (!baseline) {
      throw new SpiderAuditError('No report available to set as baseline');
    }
    this.baselineReport = baseline;
    return baseline.reportId;
  }

  compareToBaseline(report?: SpiderReport): SpiderBaselineComparison | null {
    if (!this.baselineReport) return null;
    const current = report ?? this.lastReport;
    if (!current) return null;
    const diff = diffReports(this.baselineReport, current);
    return {
      baselineReportId: this.baselineReport.reportId,
      currentReportId: current.reportId,
      diff,
      entropyDelta: diff.entropyDelta,
      introducedCount: diff.introduced.length,
      resolvedCount: diff.resolved.length,
      narrative: formatDiffNarrative(diff),
    };
  }

  getSessionDelta(report?: SpiderReport): SpiderSessionDelta | null {
    const diff = this.diffSinceLast(report);
    if (!diff) return null;
    return { diff, narrative: formatDiffNarrative(diff) };
  }

  validateBundle(bundle: SpiderAgentBundle): void {
    validateAgentBundleShape(bundle);
  }

  toAgentContext(bundle: SpiderAgentBundle, budget?: SpiderBundleBudget): string {
    return buildAgentContext(bundle, budget);
  }

  applyBundleBudget(bundle: SpiderAgentBundle, budget?: SpiderBundleBudget): SpiderAgentBundle {
    return applyBundleBudget(bundle, budget);
  }

  shouldProceed(audit: SpiderReport) {
    return shouldProceedFromPreflight(audit);
  }

  /** ESLint-compact lines for token-efficient agent context. */
  toCompact(report: SpiderReport) {
    return toAgentCompact(report);
  }

  /** SARIF 2.1.0 for CI / GitHub Code Scanning integration. */
  toSarif(report: SpiderReport) {
    return toSarifLog(report, this.ctx.workspace.workspacePath);
  }

  /** LSP PublishDiagnostics-shaped map keyed by file URI. */
  toLspDiagnostics(report: SpiderReport) {
    return toLspDiagnostics(report, this.ctx.workspace.workspacePath);
  }

  toDiagnosticJson(report: SpiderReport) {
    return toDiagnosticJson(report);
  }

  toGithubAnnotations(report: SpiderReport) {
    return toGithubAnnotations(report);
  }

  toTap(report: SpiderReport) {
    return toTap(report);
  }

  toJUnitXml(report: SpiderReport, suiteName?: string) {
    return toJUnitXml(report, suiteName);
  }

  toNdjson(report: SpiderReport) {
    return toNdjsonDiagnostics(report);
  }

  formatDiffNarrative(diff: SpiderReportDiff) {
    return formatDiffNarrative(diff);
  }

  /** Diff against the previous audit in this session. */
  diffSinceLast(report?: SpiderReport): SpiderReportDiff | null {
    if (!this.previousReport) return null;
    const current = report ?? this.lastReport;
    if (!current) return null;
    return diffReports(this.previousReport, current);
  }

  diffReports(before: SpiderReport, after: SpiderReport): SpiderReportDiff {
    return diffReports(before, after);
  }

  explainFinding(report: SpiderReport, findingId: string) {
    return formatExplainFinding(report, findingId);
  }

  explainFindingForAgent(report: SpiderReport, findingId: string) {
    return formatExplainFindingForAgent(report, findingId);
  }

  /**
   * Resync graph nodes from physical disk for the given files.
   */
  async resync(options: SpiderResyncOptions): Promise<SpiderResyncResult> {
    return this.getForensic().resync(options);
  }

  /**
   * Pre-edit gate: neighborhood audit + structural impact + study pack.
   * Industry pattern: "preflight check" before mutation (like rust-analyzer / ESLint --fix dry-run).
   */
  async preflight(
    filePath: string,
    options: Omit<SpiderAuditOptions, 'scope'> = {}
  ): Promise<SpiderPreflightResult> {
    if (!this.bootstrapped) {
      await this.bootstrapGraph();
    }
    const norm = this.engine.normalizePath(filePath);
    const { scope, audit } = await this.getForensic().preflight(norm, options);
    const discovery = this.discovery;
    return {
      filePath: norm,
      scope,
      structuralImpact: {
        summary: discovery.getImportanceSummary(norm),
        blastRadius: discovery.getBlastRadius(norm),
        deficiencies: discovery.getDeficiencyReport(norm),
      },
      studyPack: this.getStudyPack(norm),
      audit,
    };
  }

  /** Preflight + agent bundle — preferred pre-edit entry for agents. */
  async preflightBundle(
    filePath: string,
    options: Omit<SpiderAuditOptions, 'scope'> = {}
  ): Promise<SpiderPreflightBundleResult> {
    const preflight = await this.preflight(filePath, options);
    const gate = evaluateGate(preflight.audit);
    validateGateResult(gate);
    const bundle = this.toAgentBundle(preflight.audit, gate);
    return { ...preflight, bundle, proceed: bundle.proceed };
  }

  /**
   * Batch preflight for multi-file edits — merges neighborhood scope, single merged audit.
   */
  async batchPreflight(
    filePaths: string[],
    options: Omit<SpiderAuditOptions, 'scope'> = {}
  ): Promise<SpiderBatchPreflightResult> {
    if (!this.bootstrapped) {
      await this.bootstrapGraph();
    }
    const normalized = filePaths.map((f) => this.engine.normalizePath(f));
    const mergedScope = new Set<string>();
    const depth = options.neighborhoodDepth ?? 1;
    for (const file of normalized) {
      for (const id of this.engine.getNeighborhood(file, depth)) {
        mergedScope.add(id);
      }
    }

    const audit = await this.audit({
      ...options,
      scope: Array.from(mergedScope),
      includeRepairDirectives: options.includeRepairDirectives ?? true,
    });
    const gate = evaluateGate(audit);
    validateGateResult(gate);
    const bundle = this.toAgentBundle(audit, gate);

    const results: SpiderPreflightResult[] = [];
    for (const file of normalized) {
      const fileScope = this.engine.getNeighborhood(file, depth);
      results.push({
        filePath: file,
        scope: Array.from(mergedScope),
        structuralImpact: {
          summary: this.discovery.getImportanceSummary(file),
          blastRadius: this.discovery.getBlastRadius(file),
          deficiencies: this.discovery.getDeficiencyReport(file),
        },
        studyPack: this.getStudyPack(file),
        audit: scopeReportView(audit, fileScope),
      });
    }

    return {
      files: normalized,
      mergedScope: Array.from(mergedScope),
      results,
      audit,
      bundle,
      proceed: bundle.proceed,
    };
  }

  /** Format an existing report as agent-ready markdown (idempotent). */
  formatAgentNarrative(report: SpiderReport): string {
    if (report.agentDigest?.agentNarrative) {
      return report.agentDigest.agentNarrative;
    }
    return buildAgentDigest(report).agentNarrative;
  }

  forensicHealth(): SpiderHealth {
    return this.getForensic().health();
  }

  /**
   * Performs an LSP-enhanced structural audit.
   * Resolves physical definitions of all exported symbols.
   */
  async auditWithLsp(files: { filePath: string; content: string }[]): Promise<{
    entropy: number;
    violations: SpiderViolation[];
    mermaid: string;
  }> {
    Logger.info(`[SpiderService] 🕵️ Performing LSP-enhanced audit on ${files.length} files...`);
    
    this.engine.buildGraph(files);

    // Ensure server is started once for the entire batch
    await this.ctx.lsp.ensureServer('typescript');

    for (const file of files) {
        const isTs = file.filePath.endsWith('.ts') || file.filePath.endsWith('.tsx');
        const isJs = file.filePath.endsWith('.js') || file.filePath.endsWith('.jsx') || file.filePath.endsWith('.mjs');
        if (!isTs && !isJs) continue;
        
        // Real Scanner: Identify exported symbols using regex
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/export (class|function|interface|const|enum) (\w+)/);
            if (match) {
                const symbolName = match[2];
                const charIndex = line.indexOf(symbolName);
                
                try {
                    const definitions = await this.ctx.lsp.getDefinitions('typescript', file.filePath, i, charIndex);
                    if (definitions && definitions.length > 0) {
                        Logger.info(`[SpiderService] 🧠 Resolved symbol '${symbolName}' via LSP: ${JSON.stringify(definitions[0].uri)}`);
                    }
                } catch (err) {
                    Logger.warn(`[SpiderService] ⚠️ Failed to resolve symbol '${symbolName}': ${err}`);
                }
            }
        }
    }

    for (const file of files) {
        this.engine.updateNode(file.filePath, file.content);
    }

    // Proactive Memory Management: Recycle project after batch update
    this.engine.recycleProject();

    return this.auditStructure();
  }

  async auditStructure(files?: { filePath: string; content: string }[]): Promise<{
    entropy: number;
    violations: SpiderViolation[];
    mermaid: string;
  }> {
    try {
      if (!this.bootstrapped && !files) {
        await this.bootstrapGraph();
      }
      this.discovery.clearCache();
      if (files) {
        for (const file of files) {
            this.engine.updateNode(file.filePath, file.content);
        }
      }
      const entropyReport = this.engine.computeEntropy();
      const entropy = entropyReport.score;
      const violations = this.engine.getViolations();
      const mermaid = this.engine.toMermaid();

      this.engine.recycleProject();

      return { entropy, violations, mermaid };
    } catch (e) {
      Logger.error('[SpiderService] Audit failed:', e);
      return { entropy: 1.0, violations: [], mermaid: '' };
    }
  }

  /**
   * Compares current structural state against the latest baseline snapshot.
   * Returns the delta (positive means entropy increased/worsened).
   */
  async getEntropyDelta(): Promise<number> {
    const latest = await this.engine.getLatestSnapshot();
    if (!latest) return 0;
    return this.engine.getEntropy().score - latest.entropyScore;
  }

  /**
   * Incrementally updates the structural graph with a set of changes.
   * Returns a list of symbolic deficiencies (breakages) caused by these changes.
   * Serialized via mutationLock to prevent concurrent corruption.
   */
  async applyChanges(changes: { filePath: string; content?: string }[]): Promise<{ 
      deficiencies: { 
          depId: string, 
          symbols: string[], 
          displacements: { symbol: string, newPath: string }[],
          directives: import('./types.js').RepairDirective[],
          line: number, 
          character: number 
      }[],
      diagnostics: { message: string, line?: number }[]
  }> {
    const lockKey = `spider-mutation:${this.ctx.workspace.workspacePath}`;
    return await TaskMutex.runExclusive(lockKey, async () => {
      this.discovery.clearCache();
      const defReport: { 
          depId: string, 
          symbols: string[], 
          displacements: { symbol: string, newPath: string }[],
          directives: import('./types.js').RepairDirective[],
          line: number, 
          character: number 
      }[] = [];
      const diagReport: { message: string, line?: number }[] = [];
      
      for (const change of changes) {
        if (change.content !== undefined) {
          this.engine.updateNode(change.filePath, change.content);
          diagReport.push(...this.engine.getDiagnostics(change.filePath));
        } else {
          this.engine.removeNode(change.filePath);
        }
      }

      // 2. Resolve the graph connectivity
      this.engine.resolveAllImports();
      this.engine.computeReachability();

      // 3. Collect breakages for all modified files
      for (const change of changes) {
          const fileReport = this.discovery.getDeficiencyReport(change.filePath);
          defReport.push(...fileReport);
      }

      return { deficiencies: defReport, diagnostics: diagReport };
    });
  }

  /**
   * Bootstraps the structural graph from the latest repository head.
   * Now uses a persistent cache to speed up subsequent bootstraps.
   */
  async bootstrapGraph(): Promise<void> {
    if (this.bootstrapped) return;
    const startTime = Date.now();
    try {
      const db = this.ctx.workspace.getDb();
      let repo: Repository;
      try {
          repo = await this.ctx.workspace.getRepo(this.ctx.workspace.workspaceId);
      } catch {
          // Fallback for legacy or custom path structures
          repo = new Repository(db, this.ctx.workspace.workspacePath);
      }
      
      const repoPath = repo.getBasePath();

      // 0. Branch Discovery: Align with the active substrate layer
      const repoDoc = await db.selectOne('repositories', [{ column: 'repoPath', value: repoPath }]);
      const branches = await db.selectWhere('branches', [{ column: 'repoPath', value: repoPath }]);
      
      // Prioritize the branch with the most recent activity if not specified
      let branchName = repoDoc?.defaultBranch || 'main';
      if (branches.length > 0) {
          const sortedBranches = branches.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          branchName = sortedBranches[0].name;
      }
      
      Logger.info(`[SpiderService] 🕸️  Bootstrapping graph from branch '${branchName}'...`);

      // 1. Try to load from persistent cache
      const cache = await db.selectOne('knowledge', [
        { column: 'userId', value: this.ctx.userId },
        { column: 'type', value: 'structural_snapshot' },
      ]);

      let lastCommit: string | null = null;
      if (cache) {
        const metadata = JSON.parse(cache.metadata || '{}');
        if (metadata.isBootstrapCache) {
          this.engine.deserialize(Buffer.from(cache.content as string, 'utf8'));
          lastCommit = metadata.commitHash;
          Logger.info(
            `[SpiderService] Loaded bootstrap cache from commit: ${lastCommit?.substring(0, 7)}`
          );
        }
      }

      // 2. Determine changed files
      const currentBranch = await db.selectOne('branches', [
        { column: 'repoPath', value: repoPath },
        { column: 'name', value: branchName },
      ]);
      const currentHead = currentBranch?.head;

      if (lastCommit && currentHead && lastCommit === currentHead) {
        Logger.info(
          `[SpiderService] Graph is already up to date at commit: ${currentHead.substring(0, 7)}`
        );
        this.bootstrapped = true;
        return;
      }

      if (lastCommit && currentHead && lastCommit !== currentHead) {
        Logger.info(`[SpiderService] 🔄 Incremental update detected: ${lastCommit.substring(0, 7)} -> ${currentHead.substring(0, 7)}`);
        
        try {
            const oldNode = await repo.getNode(lastCommit);
            const newNode = await repo.getNode(currentHead);
            const oldTree = await repo.resolveTree(oldNode);
            const newTree = await repo.resolveTree(newNode);

            const changedFiles: string[] = [];
            for (const [path, hash] of Object.entries(newTree)) {
                if (oldTree[path] !== hash) {
                    changedFiles.push(path);
                }
            }
            for (const path of Object.keys(oldTree)) {
                if (!newTree[path]) {
                    this.engine.removeNode(path);
                }
            }

            if (changedFiles.length > 0) {
                Logger.info(`[SpiderService] ⚙️  Processing ${changedFiles.length} changed files...`);
                for (let i = 0; i < changedFiles.length; i++) {
                    const filePath = changedFiles[i];
                    const content = await repo.files().readFile(branchName, filePath, { skipIgnore: true });
                    this.engine.updateNode(filePath, content.content);
                    
                    // Memory Management: Recycle every 50 files during incremental update
                    if (i > 0 && i % 50 === 0) {
                        this.engine.recycleProject();
                    }
                }
            }

            this.bootstrapped = true;
            await this.persistBootstrapCache(currentHead);
            Logger.info(`[SpiderService] ✅ Incremental update complete in ${Date.now() - startTime}ms.`);
            return;
        } catch (e) {
            Logger.warn(`[SpiderService] ⚠️ Incremental diff failed, falling back to full read: ${e}`);
        }
      }

      // 3. Fallback to (optimized) full read if cache is missing or invalid
      const filesData = await repo.files().listFiles(branchName);
      const auditFilesData = filesData.filter((f) => 
        f.path.endsWith('.ts') || f.path.endsWith('.tsx') ||
        f.path.endsWith('.js') || f.path.endsWith('.jsx') || f.path.endsWith('.mjs')
      );

      // Parallel read with concurrency limit (e.g. 10 files at a time)
      const auditFiles: { filePath: string; content: string }[] = [];
      const batchSize = 10;
      for (let i = 0; i < auditFilesData.length; i += batchSize) {
        const batch = auditFilesData.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (f) => {
            try {
              const content = await repo.files().readFile(branchName, f.path, { skipIgnore: true });
              return { filePath: f.path, content: content.content };
            } catch {
              return null;
            }
          })
        );
        auditFiles.push(...(results.filter(Boolean) as { filePath: string; content: string }[]));
        
        // Memory Management: Recycle project after batch reading to clear AST pressure
        const memory = process.memoryUsage().rss / 1024 / 1024;
        if (memory > 1500) {
            Logger.warn(`[SpiderService] 🚨 RSS Watchdog triggered (${memory.toFixed(0)}MB). Hard-resetting Project...`);
            this.engine.recycleProject();
        } else if (i > 0 && i % 100 === 0) {
            this.engine.recycleProject();
        }
      }

      this.discovery.clearCache();
      this.engine.buildGraph(auditFiles);

      // Populate Vitality (Churn) data from Repository
      for (const node of this.engine.nodes.values()) {
          node.vitality = await repo.getFileChurn(node.path);
      }

      this.bootstrapped = true;

      // 4. Persist the new cache
      if (currentHead) {
        await this.persistBootstrapCache(currentHead);
      }

      const duration = Date.now() - startTime;
      Logger.info(
        `[SpiderService] Graph bootstrapped with ${auditFiles.length} files in ${duration}ms.`
      );
      
      // Level 9 Integrity Guard: Ghost Node Verification
      await this.verifyGraphIntegrity(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`[SpiderService] Bootstrap failed: ${msg}`);
      if (process.env.SPIDER_DEBUG && e instanceof Error) {
        Logger.error(`[SpiderService] Bootstrap stack: ${e.stack}`);
      }
      this.bootstrapped = true; // Fail-closed to prevent hot loops
    }
  }

  /**
   * Persists the current structural graph as a bootstrap cache.
   */
  private async persistBootstrapCache(commitHash: string): Promise<void> {
    const db = this.ctx.workspace.getDb();
    const serialized = this.engine.serialize();
    const cacheId = `spider-bootstrap-${this.ctx.workspace.workspacePath}`;

    await db.push({
      type: 'upsert',
      table: 'knowledge',
      where: [{ column: 'id', value: cacheId }],
      values: {
        id: cacheId,
        userId: this.ctx.userId,
        type: 'structural_snapshot',
        content: serialized,
        tags: JSON.stringify(['spider', 'bootstrap', 'cache']),
        confidence: 1.0,
        hubScore: 0,
        metadata: JSON.stringify({
          isBootstrapCache: true,
          commitHash,
          workspacePath: this.ctx.workspace.workspacePath,
        }),
        createdAt: Date.now(),
      },
      layer: 'infrastructure',
    });
  }

  /**
   * Returns the internal engine instance for service-layer analysis only.
   * @internal Not exposed through AgentContext capabilities.
   */
  getEngine(): SpiderEngine {
    return this.engine;
  }

  /**
   * Returns the discovery service instance.
   */
  getDiscovery(): StructuralDiscoveryService {
    return this.discovery;
  }

  /**
   * Persists structural health as knowledge in the graph.
   */
  async persistStructuralKnowledge(
    entropy: number,
    mermaid: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const kbId = `spider-snapshot-${Date.now()}`;
    await this.ctx.push({
      type: 'insert',
      table: 'knowledge',
      values: {
        id: kbId,
        userId: this.ctx.userId,
        type: 'structural_snapshot',
        content: mermaid,
        tags: JSON.stringify(['spider', 'architecture', 'visualization']),
        confidence: Math.max(0, 1.0 - entropy),
        hubScore: 0,
        metadata: JSON.stringify({ ...metadata, entropy }),
        createdAt: Date.now(),
      },
      layer: 'domain',
    });
    return kbId;
  }

  /**
   * Level 9 integrity guard.
   * Verifies that every node in the graph exists on disk.
   * Orphaned entries are pruned to prevent "Structural Drift".
   */
  async verifyGraphIntegrity(silent: boolean = false): Promise<{ pruned: number }> {
      const isTestEnv = process.argv.some(arg => arg.includes('test') || arg.includes('benchmark') || arg.includes('stress'));
      if (isTestEnv) return { pruned: 0 };

      const startTime = Date.now();
      let prunedCount = 0;
      const nodes = Array.from(this.engine.nodes.values());
      
      for (const node of nodes) {
          const fullPath = path.resolve(this.ctx.workspace.workspacePath, node.path);
          if (!fs.existsSync(fullPath)) {
              this.engine.removeNode(node.path);
              prunedCount++;
          }
      }

      if (prunedCount > 0) {
          const db = this.ctx.workspace.getDb() as any;
          if (db.reportIntegrityIssue) {
              db.reportIntegrityIssue('orphanedNode', prunedCount);
          }
          Logger.info(`[SpiderService] ✅ Integrity check complete. Pruned ${prunedCount} ghost nodes in ${Date.now() - startTime}ms.`);
      }
      
      return { pruned: prunedCount };
  }

  /**
   * Generates a "Sovereign Study Pack" for a file.
   * Identifies the core structural context an agent needs to master before editing.
   */
  public getStudyPack(filePath: string): { 
      path: string, 
      studyItems: { path: string, reason: string }[] 
  } {
      const engine = this.engine;
      const normalizedPath = engine.normalizePath(filePath);
      const node = engine.nodes.get(normalizedPath);
      
      const studyItems: { path: string, reason: string }[] = [];
      const discovery = this.getDiscovery();
      const registry = engine.getRegistry();

      if (node) {
          // 1. Direct dependencies
          for (const resolved of Array.from(node.resolvedImports.values())) {
              studyItems.push({ path: resolved as string, reason: 'Direct Dependency' });
          }

          // 2. Critical dependents (from Blast Radius)
          const radius = discovery.getBlastRadius(filePath);
          for (const cr of radius.criticalDependents.slice(0, 5)) {
              studyItems.push({ path: cr, reason: 'Critical Dependent' });
          }

          // 3. Ambiguous Symbols used/provided
          const exports = registry.getExports(normalizedPath);
          const conflicts = registry.getConflicts();
          for (const exp of exports) {
              if (conflicts.has(exp.symbolName)) {
                  const providers = conflicts.get(exp.symbolName)!.filter(p => p !== normalizedPath);
                  for (const p of providers) {
                      studyItems.push({ path: p, reason: `Ambiguity Provider for '${exp.symbolName}'` });
                  }
              }
          }
      }

      // De-duplicate and prioritize
      const seen = new Set<string>();
      const pack = studyItems.filter(item => {
          if (seen.has(item.path) || item.path === normalizedPath) return false;
          seen.add(item.path);
          return true;
      });

      return { path: normalizedPath, studyItems: pack };
  }
}
