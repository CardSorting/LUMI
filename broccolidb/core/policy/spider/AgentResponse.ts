// [LAYER: CORE]
/**
 * Structured check() responses for MCP, CI, and agent orchestration.
 * Mirrors ESLint `--format json`, GitHub Checks API conclusions, and SARIF upload workflows.
 */
import type {
  SpiderAgentBundle,
  SpiderCheckResponse,
  SpiderCheckResult,
  SpiderDiagnosticSummary,
  SpiderReport,
} from './report-types.js';
import { clusterFindingsByCause } from './AgentClusters.js';
import { toGithubAnnotations, toGithubStepSummary, prepareSarifUpload } from './AgentFormats.js';
import { formatCheckDigest } from './AgentToolkit.js';
import { toStructuredTelemetry } from './AgentSerialization.js';
import { SpiderAuditError } from './spider-errors.js';

export const SPIDER_CHECK_OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SpiderCheckResponse',
  type: 'object',
  required: [
    '$schema',
    'phase',
    'proceed',
    'exitCode',
    'conclusion',
    'digest',
    'agentContext',
    'workflowSummary',
    'suggestedCommands',
    'summary',
    'problemMatchers',
    'ci',
  ],
  properties: {
    $schema: { const: 'broccolidb.spider.check-response/v1' },
    phase: { enum: ['pre-edit', 'post-edit', 'ci', 'delta'] },
    proceed: { type: 'boolean' },
    exitCode: { enum: [0, 1] },
    conclusion: { enum: ['success', 'failure', 'neutral'] },
    digest: { type: 'string' },
    agentContext: { type: 'string' },
    workflowSummary: { type: 'string' },
    suggestedCommands: { type: 'array', items: { type: 'string' } },
    wire: { type: 'object' },
    telemetry: { type: 'object' },
    summary: { type: 'object' },
    problemMatchers: { type: 'array' },
    ci: { type: 'object' },
  },
} as const;

export function buildDiagnosticSummaryFromReport(report: SpiderReport): SpiderDiagnosticSummary {
  const byDiagnosticId: SpiderDiagnosticSummary['byDiagnosticId'] = {};
  for (const finding of report.findings) {
    byDiagnosticId[finding.diagnosticId] = (byDiagnosticId[finding.diagnosticId] ?? 0) + 1;
  }
  const byCause: Record<string, number> = {};
  for (const cluster of clusterFindingsByCause(report)) {
    byCause[cluster.cause] = cluster.count;
  }
  return {
    totalFindings: report.findings.length,
    errors: report.findings.filter((f) => f.severity === 'ERROR').length,
    warnings: report.findings.filter((f) => f.severity === 'WARN').length,
    info: report.findings.filter((f) => f.severity === 'INFO').length,
    driftedFiles: report.diskParity.filter((d) => d.driftStatus !== 'clean').length,
    byDiagnosticId,
    byCause,
  };
}

export function buildDiagnosticSummaryFromBundle(bundle: SpiderAgentBundle): SpiderDiagnosticSummary {
  const byCause: Record<string, number> = {};
  for (const cluster of bundle.clusters) {
    byCause[cluster.cause] = cluster.count;
  }
  const byDiagnosticId: SpiderDiagnosticSummary['byDiagnosticId'] = {};
  for (const item of bundle.priorityQueue) {
    if (item.diagnosticId) {
      byDiagnosticId[item.diagnosticId] = (byDiagnosticId[item.diagnosticId] ?? 0) + 1;
    }
  }
  const errors = bundle.priorityQueue.filter((q) => q.kind === 'blocker').length;
  const warnings = bundle.priorityQueue.filter((q) => q.kind === 'warning').length;
  const driftedFiles = bundle.priorityQueue.filter((q) => q.kind === 'drift').length;
  return {
    totalFindings: errors + warnings,
    errors,
    warnings,
    info: 0,
    driftedFiles,
    byDiagnosticId,
    byCause,
  };
}

export function resolveCheckConclusion(result: SpiderCheckResult): SpiderCheckResponse['conclusion'] {
  if (result.wire?.gate.conclusion) return result.wire.gate.conclusion;
  if (result.gate?.conclusion) return result.gate.conclusion;
  if (result.bundle?.gate.conclusion) return result.bundle.gate.conclusion;
  return result.proceed ? 'success' : 'failure';
}

export function validateCheckResult(result: unknown): asserts result is SpiderCheckResult {
  if (!result || typeof result !== 'object') {
    throw new SpiderAuditError('SpiderCheckResult must be a non-null object');
  }
  const r = result as SpiderCheckResult;
  if (!['pre-edit', 'post-edit', 'ci', 'delta'].includes(r.phase)) {
    throw new SpiderAuditError('check.phase invalid');
  }
  if (typeof r.proceed !== 'boolean') throw new SpiderAuditError('check.proceed required');
  if (r.exitCode !== 0 && r.exitCode !== 1) throw new SpiderAuditError('check.exitCode must be 0 or 1');
  if (!r.agentContext) throw new SpiderAuditError('check.agentContext required');
  if (!r.workflowSummary) throw new SpiderAuditError('check.workflowSummary required');
  if (!Array.isArray(r.workflow)) throw new SpiderAuditError('check.workflow required');
  if (!Array.isArray(r.suggestedCommands)) throw new SpiderAuditError('check.suggestedCommands required');
}

export interface ToCheckResponseOptions {
  maxCompactLines?: number;
  includeSarifMeta?: boolean;
  workspaceRoot?: string;
}

/** Build machine-parseable check envelope — preferred MCP/CI transport when responseFormat=json. */
export function toCheckResponse(
  result: SpiderCheckResult,
  options: ToCheckResponseOptions = {}
): SpiderCheckResponse {
  validateCheckResult(result);
  const maxCompactLines = options.maxCompactLines ?? 8;
  const digest = formatCheckDigest(result, maxCompactLines);
  const bundle = result.bundle;
  const report = result.gate?.report;
  const summary = report
    ? buildDiagnosticSummaryFromReport(report)
    : bundle
      ? buildDiagnosticSummaryFromBundle(bundle)
      : {
          totalFindings: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          driftedFiles: 0,
          byDiagnosticId: {},
          byCause: {},
        };

  const githubAnnotations =
    bundle?.formats.githubAnnotations ?? (report ? toGithubAnnotations(report) : []);
  const githubStepSummary = bundle
    ? toGithubStepSummary(bundle, summary)
    : `## Spider ${result.phase}\n\nNo bundle — ${result.workflowSummary}`;

  const sarifMeta =
    options.includeSarifMeta && report
      ? (() => {
          const upload = prepareSarifUpload(report, options.workspaceRoot);
          return {
            artifactName: upload.artifactName,
            reportId: upload.reportId,
            exitCode: upload.exitCode,
          };
        })()
      : undefined;

  return {
    $schema: 'broccolidb.spider.check-response/v1',
    phase: result.phase,
    proceed: result.proceed,
    exitCode: result.exitCode,
    conclusion: resolveCheckConclusion(result),
    digest,
    agentContext: result.agentContext,
    workflowSummary: result.workflowSummary,
    suggestedCommands: result.suggestedCommands,
    wire: result.wire,
    telemetry: result.wire ? toStructuredTelemetry(result.wire) : undefined,
    summary,
    problemMatchers: bundle?.problemMatchers ?? [],
    ci: {
      githubAnnotations,
      githubStepSummary,
      ...(sarifMeta ? { sarif: sarifMeta } : {}),
    },
  };
}

/** CI hard-stop helper — mirrors `process.exit(gate.exitCode)` patterns. */
export function assertCheckPassed(result: SpiderCheckResult, message?: string): void {
  validateCheckResult(result);
  if (result.exitCode !== 0) {
    throw new SpiderAuditError(message ?? `Spider check failed (phase=${result.phase}, exit=${result.exitCode})`);
  }
}
