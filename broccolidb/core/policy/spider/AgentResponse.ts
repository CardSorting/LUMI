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
  SpiderGithubCheckRun,
  SpiderReport,
} from './report-types.js';
import { clusterFindingsByCause } from './AgentClusters.js';
import {
  toGithubAnnotations,
  toGithubCheckAnnotations,
  toGithubStepSummary,
  prepareSarifUpload,
} from './AgentFormats.js';
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

/** GitHub REST Checks API createCheckRun payload from check response. */
export function toGithubCheckRun(response: SpiderCheckResponse, report?: SpiderReport): SpiderGithubCheckRun {
  const conclusion =
    response.conclusion === 'success'
      ? 'success'
      : response.conclusion === 'neutral'
        ? 'neutral'
        : 'failure';
  const annotations = report ? toGithubCheckAnnotations(report).slice(0, 50) : undefined;
  return {
    name: 'Spider Forensic',
    status: 'completed',
    conclusion,
    output: {
      title: `Spider ${response.phase} — ${response.conclusion}`,
      summary: response.ci.githubStepSummary,
      text: response.digest,
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
    },
  };
}

/** NDJSON event stream for check results — rustc/ESLint streaming CI parsers. */
export function toCheckNdjsonStream(response: SpiderCheckResponse): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: 'spider.check.start',
      schema: response.$schema,
      phase: response.phase,
      conclusion: response.conclusion,
    })
  );
  for (const annotation of response.ci.githubAnnotations.slice(0, 100)) {
    lines.push(JSON.stringify({ type: 'spider.check.annotation', phase: response.phase, line: annotation }));
  }
  for (const compact of response.wire?.compactLines ?? []) {
    lines.push(JSON.stringify({ type: 'spider.check.compact', phase: response.phase, line: compact }));
  }
  for (const cmd of response.suggestedCommands.slice(0, 5)) {
    lines.push(JSON.stringify({ type: 'spider.check.command', phase: response.phase, command: cmd }));
  }
  lines.push(
    JSON.stringify({
      type: 'spider.check.summary',
      phase: response.phase,
      summary: response.summary,
      telemetry: response.telemetry,
    })
  );
  lines.push(
    JSON.stringify({
      type: 'spider.check.end',
      phase: response.phase,
      exitCode: response.exitCode,
      proceed: response.proceed,
      conclusion: response.conclusion,
    })
  );
  if (response.exitCode !== 0) {
    lines.push(
      JSON.stringify({
        type: 'spider.check.failure',
        phase: response.phase,
        schema: 'broccolidb.spider.failure/v1',
        source: 'check',
        exitCode: 1,
        proceed: false,
        digest: response.digest,
        conclusion: response.conclusion,
      })
    );
  }
  return lines.join('\n');
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

export interface SpiderCheckResponseValidationIssue {
  code: string;
  message: string;
  field?: string;
}

function toCheckResponseValidationIssue(error: unknown): SpiderCheckResponseValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('$schema')) return { code: 'SPI-RESP-001', message, field: '$schema' };
  if (message.includes('phase')) return { code: 'SPI-RESP-002', message, field: 'phase' };
  if (message.includes('exitCode')) return { code: 'SPI-RESP-003', message, field: 'exitCode' };
  if (message.includes('conclusion')) return { code: 'SPI-RESP-004', message, field: 'conclusion' };
  if (message.includes('digest')) return { code: 'SPI-RESP-005', message, field: 'digest' };
  return { code: 'SPI-RESP-000', message };
}

export function isCheckResponse(value: unknown): value is SpiderCheckResponse {
  try {
    validateCheckResponse(value);
    return true;
  } catch {
    return false;
  }
}

export function validateCheckResponse(response: unknown): asserts response is SpiderCheckResponse {
  if (!response || typeof response !== 'object') {
    throw new SpiderAuditError('SpiderCheckResponse must be a non-null object');
  }
  const r = response as SpiderCheckResponse;
  if (r.$schema !== 'broccolidb.spider.check-response/v1') {
    throw new SpiderAuditError('check-response.$schema must be broccolidb.spider.check-response/v1');
  }
  if (!['pre-edit', 'post-edit', 'ci', 'delta'].includes(r.phase)) {
    throw new SpiderAuditError('check-response.phase invalid');
  }
  if (typeof r.proceed !== 'boolean') throw new SpiderAuditError('check-response.proceed required');
  if (r.exitCode !== 0 && r.exitCode !== 1) {
    throw new SpiderAuditError('check-response.exitCode must be 0 or 1');
  }
  if (!['success', 'failure', 'neutral'].includes(r.conclusion)) {
    throw new SpiderAuditError('check-response.conclusion invalid');
  }
  if (!r.digest) throw new SpiderAuditError('check-response.digest required');
  if (!r.agentContext) throw new SpiderAuditError('check-response.agentContext required');
  if (!r.workflowSummary) throw new SpiderAuditError('check-response.workflowSummary required');
  if (!Array.isArray(r.suggestedCommands)) {
    throw new SpiderAuditError('check-response.suggestedCommands required');
  }
  if (!r.summary || typeof r.summary !== 'object') {
    throw new SpiderAuditError('check-response.summary required');
  }
  if (!r.ci || typeof r.ci !== 'object') throw new SpiderAuditError('check-response.ci required');
}

export function safeValidateCheckResponse(
  response: unknown
):
  | { valid: true; response: SpiderCheckResponse }
  | { valid: false; errors: string[]; issues: SpiderCheckResponseValidationIssue[] } {
  try {
    validateCheckResponse(response);
    return { valid: true, response: response as SpiderCheckResponse };
  } catch (error) {
    const issue = toCheckResponseValidationIssue(error);
    return { valid: false, errors: [issue.message], issues: [issue] };
  }
}

export function parseCheckResponseJson(json: string): SpiderCheckResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SpiderAuditError('check-response JSON must be valid JSON');
  }
  validateCheckResponse(parsed);
  return parsed;
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

  const conclusion = resolveCheckConclusion(result);
  const ciBase = {
    githubAnnotations,
    githubStepSummary,
    ...(sarifMeta ? { sarif: sarifMeta } : {}),
  };

  const response: SpiderCheckResponse = {
    $schema: 'broccolidb.spider.check-response/v1',
    phase: result.phase,
    proceed: result.proceed,
    exitCode: result.exitCode,
    conclusion,
    digest,
    agentContext: result.agentContext,
    workflowSummary: result.workflowSummary,
    suggestedCommands: result.suggestedCommands,
    wire: result.wire,
    telemetry: result.wire ? toStructuredTelemetry(result.wire) : undefined,
    summary,
    problemMatchers: bundle?.problemMatchers ?? [],
    ci: {
      ...ciBase,
      githubCheckRun: toGithubCheckRun(
        {
          $schema: 'broccolidb.spider.check-response/v1',
          phase: result.phase,
          proceed: result.proceed,
          exitCode: result.exitCode,
          conclusion,
          digest,
          agentContext: result.agentContext,
          workflowSummary: result.workflowSummary,
          suggestedCommands: result.suggestedCommands,
          wire: result.wire,
          telemetry: result.wire ? toStructuredTelemetry(result.wire) : undefined,
          summary,
          problemMatchers: bundle?.problemMatchers ?? [],
          ci: ciBase,
        },
        report
      ),
    },
  };

  return response;
}

/** CI hard-stop helper — mirrors `process.exit(gate.exitCode)` patterns. */
export function assertCheckPassed(result: SpiderCheckResult, message?: string): void {
  validateCheckResult(result);
  if (result.exitCode !== 0) {
    throw new SpiderAuditError(message ?? `Spider check failed (phase=${result.phase}, exit=${result.exitCode})`);
  }
}
