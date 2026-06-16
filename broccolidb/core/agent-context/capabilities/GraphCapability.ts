// [LAYER: CORE]
// @classification CAPABILITY
import { randomUUID } from 'node:crypto';
import type { GraphService } from '../GraphService.js';
import type { SpiderService } from '../SpiderService.js';
import type {
  SpiderAuditOptions,
  SpiderResyncOptions,
  SpiderReport,
  SpiderGateResult,
  SpiderReportDiff,
  SpiderAgentBundle,
  SpiderBatchPreflightResult,
  SpiderBaselineComparison,
  SpiderGateBundleResult,
  SpiderPreflightBundleResult,
  SpiderCheckRequest,
  SpiderCheckResult,
  SpiderBaselineBundleResult,
  SpiderBundleBudget,
  SpiderBundleWireFormat,
  SpiderCheckPipelineRequest,
  SpiderCheckPipelineResult,
  SpiderScenarioRunResult,
} from '../../policy/spider/report-types.js';
import { CapabilityBase } from '../CapabilityBase.js';
import { buildSpiderInputSummary, summarizeSpiderIntentResult } from '../../policy/spider/AgentSpiderIntent.js';
import type { SpiderAgentScenario } from '../../policy/spider/AgentDecisionGuide.js';
import type { IntentTracer } from '../IntentTracer.js';
import {
  requireNonEmptyString,
  type GraphAddKnowledgeInput,
  type GraphAddKnowledgeResult,
  type GraphAnnotateKnowledgeInput,
  type GraphAnnotateKnowledgeResult,
  type GraphKnowledgeBatchInput,
  type GraphKnowledgeBatchResult,
  type GraphKnowledgeIdInput,
  type GraphKnowledgeResult,
  type GraphMergeKnowledgeInput,
  type GraphMergeKnowledgeResult,
  type GraphStructuralImpactInput,
  type GraphStructuralImpactResult,
  type GraphTraverseInput,
  type GraphTraverseResult,
  type GraphUpdateKnowledgeInput,
  type GraphUpdateKnowledgeResult,
} from '../capability-types.js';

export class GraphCapability extends CapabilityBase {
  readonly name = 'graph' as const;
  readonly dependencies = ['GraphService', 'SpiderService'] as const;

  constructor(
    private readonly graphService: GraphService,
    private readonly spiderService: SpiderService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async addKnowledge(input: GraphAddKnowledgeInput): Promise<GraphAddKnowledgeResult> {
    return this.execute('addKnowledge', async () => {
      const kbId = await this.graphService.addKnowledge(
        requireNonEmptyString(input.kbId, 'kbId'),
        input.type,
        requireNonEmptyString(input.content, 'content'),
        {
          tags: input.tags,
          edges: input.edges,
          embedding: input.embedding,
          confidence: input.confidence,
          expiresAt: input.expiresAt,
          metadata: input.metadata,
        }
      );
      return { kbId };
    });
  }

  async updateKnowledge(input: GraphUpdateKnowledgeInput): Promise<GraphUpdateKnowledgeResult> {
    return this.execute('updateKnowledge', async () => {
      const kbId = requireNonEmptyString(input.kbId, 'kbId');
      await this.graphService.updateKnowledge(kbId, input.patch);
      return { updated: true, kbId };
    });
  }

  async deleteKnowledge(input: GraphKnowledgeIdInput): Promise<{ deleted: true; kbId: string }> {
    return this.execute('deleteKnowledge', async () => {
      const kbId = requireNonEmptyString(input.kbId, 'kbId');
      await this.graphService.deleteKnowledge(kbId);
      return { deleted: true, kbId };
    });
  }

  async mergeKnowledge(input: GraphMergeKnowledgeInput): Promise<GraphMergeKnowledgeResult> {
    return this.execute('mergeKnowledge', async () => {
      const sourceId = requireNonEmptyString(input.sourceId, 'sourceId');
      const targetId = requireNonEmptyString(input.targetId, 'targetId');
      await this.graphService.mergeKnowledge(sourceId, targetId);
      return { merged: true, sourceId, targetId };
    });
  }

  async getKnowledge(input: GraphKnowledgeIdInput): Promise<GraphKnowledgeResult> {
    return this.execute('getKnowledge', async () => ({
      item: await this.graphService.getKnowledge(requireNonEmptyString(input.kbId, 'kbId')),
    }));
  }

  async getKnowledgeBatch(input: GraphKnowledgeBatchInput): Promise<GraphKnowledgeBatchResult> {
    return this.execute('getKnowledgeBatch', async () => ({
      items: await this.graphService.getKnowledgeBatch(input.ids),
    }));
  }

  async traverseGraph(input: GraphTraverseInput): Promise<GraphTraverseResult> {
    return this.execute('traverseGraph', async () => ({
      nodes: await this.graphService.traverseGraph(
        requireNonEmptyString(input.startId, 'startId'),
        input.maxDepth ?? 2,
        input.filter
      ),
    }));
  }

  async getNodeCentrality(input: GraphKnowledgeIdInput) {
    return this.execute('getNodeCentrality', async () =>
      this.graphService.getNodeCentrality(requireNonEmptyString(input.kbId, 'kbId'))
    );
  }

  async extractSubgraph(input: GraphTraverseInput) {
    return this.execute('extractSubgraph', async () =>
      this.graphService.extractSubgraph(
        requireNonEmptyString(input.startId, 'startId'),
        input.maxDepth ?? 2,
        input.filter
      )
    );
  }

  async annotateKnowledge(input: GraphAnnotateKnowledgeInput): Promise<GraphAnnotateKnowledgeResult> {
    return this.execute('annotateKnowledge', async () => {
      const targetId = requireNonEmptyString(input.targetId, 'targetId');
      const target = await this.graphService.getKnowledge(targetId);
      const edges = [...(target.edges || [])];
      const annotationId = await this.graphService.addKnowledge(
        `note-${randomUUID()}`,
        'fact',
        requireNonEmptyString(input.annotation, 'annotation'),
        {
          tags: ['annotation'],
          metadata: { ...input.metadata, targetId, agentId: input.agentId },
        }
      );
      edges.push({ targetId: annotationId, type: 'references' });
      await this.graphService.updateKnowledge(targetId, { edges });
      return { annotationId, targetId };
    });
  }

  getStructuralImpact(input: GraphStructuralImpactInput): GraphStructuralImpactResult {
    return this.run('getStructuralImpact', () => {
      const filePath = requireNonEmptyString(input.filePath, 'filePath');
      const discovery = this.spiderService.getDiscovery();
      return {
        summary: discovery.getImportanceSummary(filePath),
        blastRadius: discovery.getBlastRadius(filePath),
        deficiencies: discovery.getDeficiencyReport(filePath),
      };
    });
  }

  get spider() {
    const spiderTracing = (operation: string, input?: unknown) => ({
      input,
      inputSummary: buildSpiderInputSummary(operation, input),
      expectedEffects: [`SpiderService.${operation}`],
      durability: 'ephemeral' as const,
      summarizeResult: (result: SpiderReport | SpiderGateResult | SpiderGateBundleResult | SpiderAgentBundle | SpiderBatchPreflightResult | SpiderCheckResult | SpiderCheckPipelineResult | { resynced?: string[]; passed?: boolean; audit?: SpiderReport; digest?: string; telemetry?: Record<string, unknown> }) => {
        const intentSummary = summarizeSpiderIntentResult(operation, result);
        if ('phases' in result && Array.isArray(result.phases)) {
          return {
            ...intentSummary,
            pipelineExitCode: result.exitCode,
            phaseCount: result.phases.length,
            failedPhase: result.failedPhase ?? null,
            errors: result.response?.summary.errors ?? 0,
          };
        }
        if ('digest' in result && 'telemetry' in result) {
          return intentSummary;
        }
        if ('phase' in result && 'exitCode' in result) {
          return {
            ...intentSummary,
            phase: result.phase,
            proceed: result.proceed,
            exitCode: result.exitCode,
            workflowSteps: result.workflow?.length ?? 0,
            hasWire: Boolean(result.wire),
            errors: result.wire?.priorityQueue.filter((q) => q.kind === 'blocker').length ?? 0,
          };
        }
        if ('bundle' in result && 'gate' in result && result.gate) {
          return { proceed: result.bundle.proceed, verdict: result.bundle.verdict, exitCode: result.gate.exitCode };
        }
        if ('bundle' in result && result.bundle && 'proceed' in result) {
          return { proceed: result.proceed, verdict: result.bundle.verdict, clusters: result.bundle.clusters.length };
        }
        if ('proceed' in result && 'nextAction' in result) {
          return { proceed: result.proceed, verdict: result.verdict, clusters: result.clusters.length };
        }
        if ('conclusion' in result && 'blocked' in result) {
          return { conclusion: result.conclusion, blocked: result.blocked, exitCode: result.exitCode };
        }
        if ('audit' in result && result.audit) {
          return {
            verdict: result.audit.verdict,
            passed: result.audit.passed,
            blockers: result.audit.agentDigest?.blockers.length ?? 0,
          };
        }
        if ('verdict' in result) {
          return {
            verdict: result.verdict,
            passed: result.passed,
            blockers: result.agentDigest?.blockers.length ?? 0,
          };
        }
        return { resynced: (result as { resynced?: string[] }).resynced?.length ?? 0 };
      },
    });

    return {
      audit: (options?: SpiderAuditOptions) =>
        this.execute('spider.audit', () => this.spiderService.audit(options), spiderTracing('audit', options)),
      gate: (options?: SpiderAuditOptions) =>
        this.execute('spider.gate', () => this.spiderService.gate(options), spiderTracing('gate', options)),
      gateBundle: (options?: SpiderAuditOptions) =>
        this.execute('spider.gateBundle', () => this.spiderService.gateBundle(options), spiderTracing('gateBundle', options)),
      check: (request: SpiderCheckRequest) =>
        this.execute('spider.check', () => this.spiderService.check(request), spiderTracing('check', request)),
      checkAndRespond: (
        request: SpiderCheckRequest,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) => this.execute('spider.checkAndRespond', () => this.spiderService.checkAndRespond(request, options), spiderTracing('checkAndRespond', request)),
      runCheckPipeline: (
        request: SpiderCheckPipelineRequest,
        options?: { maxCompactLines?: number; includeSarifMeta?: boolean }
      ) =>
        this.execute('spider.runCheckPipeline', () => this.spiderService.runCheckPipeline(request, options), spiderTracing('runCheckPipeline', request)),
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
          spiderTracing('runAgentScenario', { scenario, ...params })
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
          spiderTracing('runAgentScenarioAndRespond', { scenario, ...params })
        ),
      bundle: (report: SpiderReport) =>
        this.run('spider.bundle', () => this.spiderService.toAgentBundle(report)),
      validateBundle: (bundle: SpiderAgentBundle) =>
        this.run('spider.validateBundle', () => {
          this.spiderService.validateBundle(bundle);
          return { valid: true, reportId: bundle.reportId };
        }),
      agentContext: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget) =>
        this.run('spider.agentContext', () => this.spiderService.toAgentContext(bundle, budget)),
      applyBundleBudget: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget) =>
        this.run('spider.applyBundleBudget', () => this.spiderService.applyBundleBudget(bundle, budget)),
      batchPreflight: (filePaths: string[], options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute(
          'spider.batchPreflight',
          () => this.spiderService.batchPreflight(filePaths, options),
          spiderTracing('batchPreflight', { filePaths, ...options })
        ),
      setBaseline: (report?: SpiderReport) =>
        this.run('spider.setBaseline', () => ({ reportId: this.spiderService.setBaseline(report) })),
      compareBaseline: (report?: SpiderReport) =>
        this.run('spider.compareBaseline', () => this.spiderService.compareToBaseline(report)),
      compareBaselineBundle: (report?: SpiderReport) =>
        this.run('spider.compareBaselineBundle', () => this.spiderService.compareBaselineBundle(report)),
      sessionDelta: (report?: SpiderReport) =>
        this.run('spider.sessionDelta', () => this.spiderService.getSessionDelta(report)),
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
      outputSchema: () => this.run('spider.outputSchema', () => this.spiderService.getOutputSchema()),
      handoff: (bundle: SpiderAgentBundle, budget?: SpiderBundleBudget, options?: { phase?: SpiderCheckResult['phase'] }) =>
        this.run('spider.handoff', () => this.spiderService.handoff(bundle, budget, options)),
      handoffFromCheck: (result: SpiderCheckResult, budget?: SpiderBundleBudget) =>
        this.run('spider.handoffFromCheck', () => this.spiderService.handoffFromCheck(result, budget)),
      buildCiArtifacts: (result: SpiderCheckResult, options?: { includeSarifMeta?: boolean }) =>
        this.run('spider.buildCiArtifacts', () => this.spiderService.buildCiArtifacts(result, options)),
      writeCiArtifacts: (outputDir: string, result: SpiderCheckResult, options?: { includeSarifMeta?: boolean }) =>
        this.execute('spider.writeCiArtifacts', () => this.spiderService.writeCiArtifacts(outputDir, result, options), spiderTracing('writeCiArtifacts', { outputDir })),
      serializeBundle: (bundle: SpiderAgentBundle, agentContext?: string, workflowSummary?: string) =>
        this.run('spider.serializeBundle', () =>
          this.spiderService.serializeBundle(bundle, agentContext, workflowSummary)
        ),
      parseBundleWire: (data: unknown) => this.run('spider.parseBundleWire', () => this.spiderService.parseBundleWire(data)),
      validateWire: (wire: unknown) => this.run('spider.validateWire', () => this.spiderService.validateWire(wire)),
      restoreFromWire: (wire: unknown, maxCompactLines?: number) =>
        this.run('spider.restoreFromWire', () => this.spiderService.restoreFromWire(wire, maxCompactLines), spiderTracing('restoreFromWire', { reportId: (wire as { reportId?: string })?.reportId })),
      validateWireRestore: (wire: unknown) =>
        this.run('spider.validateWireRestore', () => this.spiderService.validateWireRestore(wire)),
      getWireOutputSchema: () => this.run('spider.getWireOutputSchema', () => this.spiderService.getWireOutputSchema()),
      parseNdjsonStream: (stream: string) =>
        this.run('spider.parseNdjsonStream', () => this.spiderService.parseNdjsonStream(stream)),
      formatWireDigest: (wire: SpiderBundleWireFormat, maxCompactLines?: number) =>
        this.run('spider.formatWireDigest', () => this.spiderService.formatWireDigest(wire, maxCompactLines)),
      formatCheckDigest: (result: SpiderCheckResult, maxCompactLines?: number) =>
        this.run('spider.formatCheckDigest', () => this.spiderService.formatCheckDigest(result, maxCompactLines)),
      formatPreflightDigest: (result: SpiderCheckResult, maxCompactLines?: number) =>
        this.run('spider.formatPreflightDigest', () => this.spiderService.formatPreflightDigest(result, maxCompactLines)),
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
      resync: (options: SpiderResyncOptions) =>
        this.execute('spider.resync', () => this.spiderService.resync(options), spiderTracing('resync', options)),
      preflight: (filePath: string, options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute(
          'spider.preflight',
          () => this.spiderService.preflight(requireNonEmptyString(filePath, 'filePath'), options),
          spiderTracing('preflight', { filePath, ...options })
        ),
      preflightBundle: (filePath: string, options?: Omit<SpiderAuditOptions, 'scope'>) =>
        this.execute(
          'spider.preflightBundle',
          () => this.spiderService.preflightBundle(requireNonEmptyString(filePath, 'filePath'), options),
          spiderTracing('preflightBundle', { filePath, ...options })
        ),
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
      explain: (report: SpiderReport, findingId: string) =>
        this.run('spider.explain', () => this.spiderService.explainFinding(report, findingId)),
      explainForAgent: (report: SpiderReport, findingId: string) =>
        this.run('spider.explainForAgent', () => this.spiderService.explainFindingForAgent(report, findingId)),
      formatNarrative: (report: SpiderReport) =>
        this.run('spider.formatNarrative', () => this.spiderService.formatAgentNarrative(report)),
      bootstrapGraph: () =>
        this.execute('spider.bootstrapGraph', () => this.spiderService.bootstrapGraph()),
      applyChanges: (files: Parameters<SpiderService['applyChanges']>[0]) =>
        this.execute('spider.applyChanges', () => this.spiderService.applyChanges(files)),
      auditStructure: (files?: Parameters<SpiderService['auditStructure']>[0]) =>
        this.execute('spider.auditStructure', () => this.spiderService.auditStructure(files)),
      verifyGraphIntegrity: (deep?: boolean) =>
        this.execute('spider.verifyGraphIntegrity', () => this.spiderService.verifyGraphIntegrity(deep)),
      getStudyPack: (filePath: string) =>
        this.run('spider.getStudyPack', () =>
          this.spiderService.getStudyPack(requireNonEmptyString(filePath, 'filePath'))
        ),
    };
  }
}
