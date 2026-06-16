import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { enrichSpiderReport } from '../core/policy/spider/AgentDigest.js';
import {
  buildAgentBundle,
  buildAgentContext,
  applyBundleBudget,
  clusterFindingsByCause,
  formatMutationDigest,
  formatCheckDigest,
  shouldProceedFromPreflight,
  toProblemMatchers,
  validateGateResult,
} from '../core/policy/spider/AgentToolkit.js';
import { buildPriorityQueue } from '../core/policy/spider/AgentToolkit.js';
import { buildWorkflowPlan } from '../core/policy/spider/AgentWorkflow.js';
import { toCodeActions, toTap, toJUnitXml, toNdjsonDiagnostics } from '../core/policy/spider/AgentFormats.js';
import { serializeAgentBundle, parseAgentBundleWire, formatWireDigest, toStructuredTelemetry, validateWireFormat, SPIDER_WIRE_SCHEMA_V2 } from '../core/policy/spider/AgentSerialization.js';
import { toCheckResponse, validateCheckResult, SPIDER_CHECK_OUTPUT_SCHEMA, toCheckNdjsonStream } from '../core/policy/spider/AgentResponse.js';
import { exportProblemMatcherConfig } from '../core/policy/spider/AgentToolkit.js';
import { prepareSarifUpload, toGithubStepSummary } from '../core/policy/spider/AgentFormats.js';
import { evaluateGate } from '../core/policy/spider/AgentFormats.js';
import { SPIDER_MCP_TOOL_NAMES } from '../core/policy/spider/spider-mcp-tools.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const report = enrichSpiderReport({
    reportId: 'tk-1',
    generatedAt: new Date().toISOString(),
    scope: 'test',
    health: { pure: true, graphNodeCount: 2, compilerDelegatedToLsp: true },
    typeMirror: { compilerAvailable: false, diagnosticsComplete: false, diagnosticCount: 0, diagnostics: [] },
    footprints: [],
    diskParity: [],
    findings: [
      {
        diagnosticId: 'SPI-001',
        severity: 'ERROR',
        label: 'SPI-001',
        filePath: 'a.ts',
        evidence: [{ diagnosticId: 'SPI-001', severity: 'ERROR', filePath: 'a.ts', evidenceKind: 'import-resolution', observed: 'x', expected: 'y', rationale: 'import broken' }],
        message: 'missing',
      },
      {
        diagnosticId: 'SPI-004',
        severity: 'ERROR',
        label: 'SPI-004',
        filePath: 'b.ts',
        evidence: [{ diagnosticId: 'SPI-004', severity: 'ERROR', filePath: 'b.ts', evidenceKind: 'cycle-detection', observed: 'loop', expected: 'acyclic', rationale: 'cycle' }],
        message: 'cycle',
      },
    ],
    structuralViolations: [],
    layerViolations: [],
    cycles: [],
    repairDirectives: [
      {
        directiveId: 'd1',
        type: 'ADD_MISSING_EXPORT',
        targetFile: 'a.ts',
        suggestedValue: 'export X',
        rationale: 'fix',
        preconditions: ['ok'],
        verificationCommand: 'npx tsc --noEmit',
        riskLevel: 'low',
        supportingEvidenceIds: ['SPI-001'],
      },
    ],
    entropy: 0.3,
    degraded: false,
    degradedReasons: [],
  });

  const clusters = clusterFindingsByCause(report);
  assert.strictEqual(clusters.length, 2);
  assert.ok(clusters.every((c) => c.remediationHint.length > 0));

  const matchers = toProblemMatchers();
  assert.ok(matchers[0].pattern.length >= 2);

  const gate = evaluateGate(report);
  validateGateResult(gate);

  const bundle = buildAgentBundle(report, '/ws', gate);
  assert.strictEqual(bundle.proceed, false);
  assert.ok(bundle.brief.includes('[spider:fail]'));
  assert.ok(bundle.formats.githubAnnotations.length > 0);
  assert.ok(bundle.workflow.length > 0);
  assert.ok(bundle.priorityQueue.length > 0);

  const queue = buildPriorityQueue(report);
  assert.strictEqual(queue[0].kind, 'blocker');

  const plan = buildWorkflowPlan(bundle);
  assert.ok(plan.length > 0);

  const tap = toTap(report);
  assert.ok(tap.includes('TAP version'));

  const junit = toJUnitXml(report);
  assert.ok(junit.includes('<testsuite'));

  const ndjson = toNdjsonDiagnostics(report);
  assert.ok(ndjson.split('\n').length >= 1);

  const wire = serializeAgentBundle(bundle, 'ctx', 'summary');
  assert.strictEqual(wire.reportId, bundle.reportId);
  assert.ok(parseAgentBundleWire(wire));

  const budgeted = applyBundleBudget(bundle, { maxCompactLines: 1, maxDiagnostics: 1 });
  assert.ok(budgeted.truncation);
  assert.strictEqual(budgeted.compactLines.length, 1);

  const agentCtxText = buildAgentContext(budgeted);
  assert.ok(agentCtxText.includes('Next:'));

  const actions = toCodeActions(report);
  assert.ok(actions[0].verificationCommand);
  assert.ok(bundle.nextAction.length > 0);
  assert.ok(bundle.clusters.length === 2);
  assert.ok(bundle.compactLines.length === 2);

  const digest = formatMutationDigest(bundle, 4);
  assert.ok(digest.includes('Spider Gate'));
  assert.ok(digest.includes('Next:'));

  const proceed = shouldProceedFromPreflight(report);
  assert.strictEqual(proceed.proceed, false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-toolkit-'));
  setDbPath(path.join(root, 'tk.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'tk-user', 'tk-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'tk-user');
  await ctx.start();

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const A = 1;\n');
  fs.writeFileSync(path.join(root, 'src/b.ts'), 'import { A } from "./a";\nexport const B = A;\n');

  await ctx.graph.spider.applyChanges([
    { filePath: 'src/a.ts', content: 'export const A = 1;\n' },
    { filePath: 'src/b.ts', content: 'import { A } from "./a";\nexport const B = A;\n' },
  ]);

  const audit1 = await ctx.graph.spider.audit({ scope: ['src/a.ts'], includeTypes: false });
  const baselineId = ctx.graph.spider.setBaseline(audit1).reportId;
  assert.ok(baselineId);

  const audit2 = await ctx.graph.spider.audit({ scope: ['src/a.ts'], includeTypes: false });
  const comparison = ctx.graph.spider.compareBaseline(audit2);
  assert.ok(comparison);

  const diff = ctx.graph.spider.diffSinceLast();
  assert.ok(diff);

  const batch = await ctx.graph.spider.batchPreflight(['src/a.ts', 'src/b.ts'], { includeTypes: false });
  assert.ok(batch.mergedScope.length >= 2);
  assert.ok(batch.bundle.narrative.length >= 0);

  const preBundle = await ctx.graph.spider.preflightBundle('src/a.ts', { includeTypes: false });
  assert.ok(preBundle.bundle.brief);

  const session = ctx.graph.spider.sessionDelta();
  assert.ok(session === null || session.narrative.includes('Spider Delta'));

  const schema = ctx.graph.spider.toolSchema();
  assert.strictEqual(schema.name, 'spider_forensic_audit');

  const fullBundle = ctx.graph.spider.bundle(audit2);
  assert.ok(fullBundle.formats.sarif);
  assert.ok(fullBundle.suggestedCommands.length >= 0);

  const handoff = ctx.graph.spider.handoff(fullBundle, undefined, { phase: 'ci' });
  assert.ok(handoff.wire?.suggestedCommands);
  assert.strictEqual(handoff.wire?.wireSchema, SPIDER_WIRE_SCHEMA_V2);
  assert.ok(handoff.checkResponse?.$schema === 'broccolidb.spider.check-response/v1');

  const outputSchema = ctx.graph.spider.outputSchema();
  assert.ok(outputSchema.title);

  const checkPre = await ctx.graph.spider.check({ phase: 'pre-edit', filePath: 'src/a.ts', includeTypes: false });
  assert.ok(checkPre.agentContext.includes('Next:'));
  assert.ok(Array.isArray(checkPre.workflow));
  assert.ok(checkPre.wire?.reportId);

  const checkCi = await ctx.graph.spider.check({ phase: 'ci', scope: ['src/a.ts'], includeTypes: false });
  assert.ok(checkCi.workflowSummary.length > 0);

  const handoffFromCheck = ctx.graph.spider.handoffFromCheck(checkCi);
  assert.ok(handoffFromCheck.wire.ndjsonStream?.includes('spider.check.start'));

  const ciArtifacts = ctx.graph.spider.buildCiArtifacts(checkCi, { includeSarifMeta: true });
  assert.ok(ciArtifacts.files.length >= 4);
  assert.ok(ciArtifacts.manifest.includes('broccolidb.spider.ci-artifacts/v1'));

  const artifactDir = path.join(root, 'ci-artifacts');
  const written = await ctx.graph.spider.writeCiArtifacts(artifactDir, checkCi);
  assert.ok(written.length >= ciArtifacts.files.length);
  assert.ok(fs.existsSync(path.join(artifactDir, 'spider-step-summary.md')));

  const checkDigest = formatCheckDigest(checkCi);
  assert.ok(checkDigest.includes('Spider ci'));
  assert.ok(checkDigest.includes('exit'));

  assert.throws(() => validateWireFormat({}), /wire\.reportId/);
  const handoffWire = handoff.wire!;
  validateWireFormat(handoffWire);
  const wireDigest = formatWireDigest(handoffWire, 3);
  assert.ok(wireDigest.includes('Spider Wire'));
  const telemetry = toStructuredTelemetry(handoffWire);
  assert.strictEqual(telemetry.event, 'spider.forensic');
  assert.ok(typeof telemetry.blockerCount === 'number');

  const checkSchema = ctx.graph.spider.getCheckOutputSchema();
  assert.strictEqual(checkSchema.properties.$schema.const, 'broccolidb.spider.check-response/v1');

  const checkResponse = ctx.graph.spider.toCheckResponse(checkCi, { includeSarifMeta: true });
  assert.strictEqual(checkResponse.$schema, 'broccolidb.spider.check-response/v1');
  assert.ok(checkResponse.digest.includes('Spider ci'));
  assert.ok(checkResponse.ci.githubStepSummary.includes('Spider Forensic Check'));
  assert.ok(Array.isArray(checkResponse.problemMatchers));
  validateCheckResult(checkCi);

  const sarifUpload = ctx.graph.spider.prepareSarifUpload(audit2);
  assert.ok(sarifUpload.artifactName.endsWith('.sarif.json'));
  assert.strictEqual(sarifUpload.reportId, audit2.reportId);
  assert.ok(sarifUpload.sarif.version === '2.1.0');

  const diagSummary = ctx.graph.spider.buildDiagnosticSummary(audit2);
  assert.ok(typeof diagSummary.errors === 'number');
  const stepSummary = toGithubStepSummary(fullBundle, diagSummary);
  assert.ok(stepSummary.includes('| Verdict |'));

  const ndjsonStream = toCheckNdjsonStream(checkResponse);
  assert.ok(ndjsonStream.includes('spider.check.start'));
  assert.ok(ndjsonStream.includes('spider.check.end'));

  const problemMatchers = exportProblemMatcherConfig();
  assert.strictEqual(problemMatchers.version, 2);
  assert.ok(problemMatchers.problemMatchers[0].owner === 'spider');

  const githubCheck = ctx.graph.spider.toGithubCheckRun(checkCi);
  assert.strictEqual(githubCheck.status, 'completed');
  assert.ok(githubCheck.output.title.includes('Spider'));

  const pipeline = await ctx.graph.spider.runCheckPipeline({
    phases: ['pre-edit', 'ci'],
    filePath: 'src/a.ts',
    scope: ['src/a.ts'],
    includeTypes: false,
  });
  assert.ok(pipeline.phases.length >= 2);
  assert.strictEqual(pipeline.exitCode, 0);

  const responded = await ctx.graph.spider.checkAndRespond({
    phase: 'ci',
    scope: ['src/a.ts'],
    includeTypes: false,
  });
  assert.strictEqual(responded.$schema, 'broccolidb.spider.check-response/v1');

  const mcpSource = fs.readFileSync(path.join(packageRoot, 'core/mcp.ts'), 'utf8');
  for (const toolName of SPIDER_MCP_TOOL_NAMES) {
    assert.ok(mcpSource.includes(`'${toolName}'`), `MCP must register ${toolName}`);
  }
  assert.ok(mcpSource.includes('responseFormat'), 'MCP spider_forensic_check must support responseFormat');

  const catalog = ctx.graph.spider.getAgentToolkitCatalog();
  assert.strictEqual(catalog.schema, 'broccolidb.spider.agent-catalog/v1');
  assert.ok(catalog.runbook.includes('Spider Forensic Agent Runbook'));
  assert.ok(catalog.mcpTools.length === SPIDER_MCP_TOOL_NAMES.length);
  assert.ok(catalog.phaseWorkflow.length === 4);
  assert.ok(catalog.promptDigest.includes('spider_get_catalog'));
  assert.ok(ctx.graph.spider.formatCatalogPrompt().includes('Phases:'));

  ctx.graph.spider.validateCheckRequest({ phase: 'ci', scope: ['src/a.ts'] });
  assert.throws(() => ctx.graph.spider.validateCheckRequest({ phase: 'pre-edit' }), /filePath/);
  assert.throws(() => ctx.graph.spider.validateCheckRequest({ phase: 'ci', gatePreset: 'bogus' as 'ci' }), /gatePreset/);
  assert.throws(() => ctx.graph.spider.validateCheckRequest({ phase: 'ci', correlationId: '  ' }), /correlationId/);

  const presets = ctx.graph.spider.getGatePolicyPresets();
  assert.ok(presets.ci.blockOnErrors);
  assert.ok(!presets.advisory.blockOnErrors);

  const inputSchema = ctx.graph.spider.getCheckInputSchema();
  assert.strictEqual(inputSchema.title, 'SpiderCheckRequest');

  const workflowPresets = ctx.graph.spider.getWorkflowPresets();
  assert.ok(workflowPresets['pr-review'].phases.includes('delta'));

  const safe = ctx.graph.spider.safeValidateCheckRequest({ phase: 'ci', scope: ['src/a.ts'] });
  assert.strictEqual(safe.valid, true);
  const bad = ctx.graph.spider.safeValidateCheckRequest({ phase: 'bogus' as 'ci' });
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.issues[0]?.code.startsWith('SPI-VAL-'));

  const normalized = ctx.graph.spider.normalizeCheckRequest({ phase: 'ci' });
  assert.strictEqual(normalized.scope, 'changed-files');
  assert.strictEqual(normalized.gatePreset, 'ci');

  const recommended = ctx.graph.spider.recommendCheckRequest('before-edit', { filePath: 'src/a.ts' });
  assert.strictEqual(recommended.phase, 'pre-edit');

  const registry = ctx.graph.spider.getSchemaRegistry();
  assert.ok(registry.schemas['broccolidb.spider.check-request/v1']);
  assert.ok(ctx.graph.spider.formatAgentDecisionGuide().includes('before-edit'));

  const pipelineSafe = ctx.graph.spider.safeValidateCheckPipelineRequest({
    workflowPreset: 'local-edit',
    filePath: 'src/a.ts',
  });
  assert.strictEqual(pipelineSafe.valid, true);
  assert.deepStrictEqual(pipelineSafe.normalized.phases, ['pre-edit', 'post-edit']);

  const scenario = await ctx.graph.spider.runAgentScenario('before-edit', { filePath: 'src/a.ts' });
  assert.strictEqual(scenario.scenario, 'before-edit');
  assert.strictEqual(scenario.kind, 'check');
  assert.ok(scenario.digest.includes('Spider'));

  const artifacts = ctx.graph.spider.buildCiArtifacts(scenario.check!);
  assert.ok(artifacts.files.some((f) => f.name === 'schema-registry'));

  await ctx.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-agent-toolkit.test failed:', error);
    process.exit(1);
  });
