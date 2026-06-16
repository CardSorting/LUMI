// [LAYER: CORE]
import * as crypto from 'node:crypto';
import type {
  RepairDirective,
  SpiderDiagnosticId,
  SpiderFinding,
  SpiderPlaybookStep,
  SpiderReport,
  SpiderSeverity,
} from './report-types.js';
import { SPI_LABELS } from './report-types.js';
import { SpiderAuditError } from './spider-errors.js';
import { SPI_RULE_DOCS, formatLocationUri } from './spider-constants.js';

export type SpiderVerdict = 'pass' | 'warn' | 'fail';

export interface SpiderFindingRef {
  findingId: string;
  diagnosticId: SpiderDiagnosticId;
  label: string;
  severity: SpiderSeverity;
  filePath: string;
  symbolName?: string;
  message: string;
  line?: number;
  column?: number;
  location?: string;
  ruleDoc?: string;
}

export interface SpiderRecommendedAction {
  priority: number;
  action: string;
  directiveId?: string;
  diagnosticId: SpiderDiagnosticId;
  filePath: string;
  verificationCommand?: string;
  riskLevel?: RepairDirective['riskLevel'];
}

export interface SpiderAgentDigest {
  verdict: SpiderVerdict;
  passed: boolean;
  summary: string;
  counts: { errors: number; warnings: number; info: number; total: number };
  byDiagnosticId: Partial<Record<SpiderDiagnosticId, number>>;
  byFile: Record<string, { errors: number; warnings: number; info: number }>;
  blockers: SpiderFindingRef[];
  warnings: SpiderFindingRef[];
  driftedFiles: string[];
  recommendedActions: SpiderRecommendedAction[];
  playbook: SpiderPlaybookStep[];
  /** Markdown optimized for LLM tool context — cite findingId and directiveId. */
  agentNarrative: string;
}

const SEVERITY_RANK: Record<SpiderSeverity, number> = { ERROR: 0, WARN: 1, INFO: 2 };

export function stableFindingId(finding: Pick<SpiderFinding, 'diagnosticId' | 'filePath' | 'message' | 'symbolName'>): string {
  const key = [finding.diagnosticId, finding.filePath, finding.symbolName ?? '', finding.message].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function assignFindingIds(findings: SpiderFinding[]): SpiderFinding[] {
  return findings.map((f) => ({
    ...f,
    findingId: f.findingId ?? stableFindingId(f),
    evidence: f.evidence.map((ev, i) => ({
      ...ev,
      evidenceId: ev.evidenceId ?? `${stableFindingId(f)}:${i}`,
    })),
  }));
}

export function computeVerdict(findings: SpiderFinding[], degraded: boolean): SpiderVerdict {
  const hasError = findings.some((f) => f.severity === 'ERROR');
  const hasWarn = findings.some((f) => f.severity === 'WARN');
  if (hasError) return 'fail';
  if (hasWarn || degraded) return 'warn';
  return 'pass';
}

export function buildRecommendedActions(
  findings: SpiderFinding[],
  directives: RepairDirective[]
): SpiderRecommendedAction[] {
  const actions: SpiderRecommendedAction[] = [];
  const riskRank = { high: 0, medium: 1, low: 2 };

  for (const directive of directives) {
    const diagId = (directive.supportingEvidenceIds[0] ?? 'SPI-001') as SpiderDiagnosticId;
    actions.push({
      priority: riskRank[directive.riskLevel] ?? 2,
      action: `[${directive.type}] ${directive.rationale}`,
      directiveId: directive.directiveId,
      diagnosticId: diagId,
      filePath: directive.targetFile,
      verificationCommand: directive.verificationCommand,
      riskLevel: directive.riskLevel,
    });
  }

  for (const finding of findings.filter((f) => f.severity === 'ERROR')) {
    if (actions.some((a) => a.filePath === finding.filePath && a.diagnosticId === finding.diagnosticId)) {
      continue;
    }
    actions.push({
      priority: 3,
      action: `Resolve ${finding.diagnosticId} (${SPI_LABELS[finding.diagnosticId]}): ${finding.message}`,
      diagnosticId: finding.diagnosticId,
      filePath: finding.filePath,
    });
  }

  return actions.sort((a, b) => a.priority - b.priority);
}

export function toFindingRef(finding: SpiderFinding): SpiderFindingRef {
  const range = finding.sourceRange ?? finding.evidence[0]?.sourceRange;
  const findingId = finding.findingId ?? stableFindingId(finding);
  return {
    findingId,
    diagnosticId: finding.diagnosticId,
    label: finding.label,
    severity: finding.severity,
    filePath: finding.filePath,
    symbolName: finding.symbolName,
    message: finding.message,
    line: range?.startLine,
    column: range?.startColumn,
    location: formatLocationUri(finding.filePath, range?.startLine, range?.startColumn),
    ruleDoc: SPI_RULE_DOCS[finding.diagnosticId],
  };
}

export function buildPlaybook(
  report: SpiderReport,
  driftedFiles: string[],
  directives: RepairDirective[],
  blockers: SpiderFindingRef[]
): SpiderPlaybookStep[] {
  const steps: SpiderPlaybookStep[] = [];
  let n = 1;

  for (const file of driftedFiles) {
    steps.push({
      step: n++,
      phase: 'resync',
      instruction: `Resync disk parity for ${file} before symbolic repair.`,
      command: `await ctx.graph.spider.resync({ files: ['${file}'] })`,
      findingIds: blockers.filter((b) => b.filePath === file).map((b) => b.findingId),
    });
  }

  for (const directive of directives.slice(0, 10)) {
    steps.push({
      step: n++,
      phase: 'repair',
      instruction: directive.rationale,
      command: directive.verificationCommand,
      directiveIds: [directive.directiveId],
      findingIds: blockers
        .filter((b) => directive.supportingEvidenceIds.includes(b.diagnosticId))
        .map((b) => b.findingId),
    });
  }

  if (directives.length > 0) {
    steps.push({
      step: n++,
      phase: 'verify',
      instruction: 'Re-run audit to confirm blockers resolved.',
      command: 'await ctx.graph.spider.gate({ scope: "changed-files" })',
    });
  }

  for (const blocker of blockers.filter((b) => !directives.some((d) => d.targetFile === b.filePath)).slice(0, 5)) {
    steps.push({
      step: n++,
      phase: 'investigate',
      instruction: `Investigate ${blocker.diagnosticId} at ${blocker.location ?? blocker.filePath}: ${blocker.message}`,
      command: `await ctx.graph.spider.explain(report, '${blocker.findingId}')`,
      findingIds: [blocker.findingId],
    });
  }

  if (steps.length === 0 && blockers.length > 0) {
    steps.push({
      step: n++,
      phase: 'verify',
      instruction: 'Re-run gate to confirm structural blockers.',
      command: 'await ctx.graph.spider.gate({ scope: "changed-files" })',
      findingIds: blockers.slice(0, 5).map((b) => b.findingId),
    });
  }

  return steps;
}

export function formatAgentNarrative(digest: SpiderAgentDigest, report: SpiderReport): string {
  const lines: string[] = [
    `## Spider Forensic Report`,
    `**Verdict:** ${digest.verdict.toUpperCase()} | **Scope:** ${report.scope} | **Entropy:** ${report.entropy.toFixed(3)}`,
    digest.summary,
    '',
  ];

  if (report.degraded) {
    lines.push(`> ⚠️ Degraded audit: ${report.degradedReasons.join('; ')}`, '');
  }

  if (digest.driftedFiles.length > 0) {
    lines.push(`### Reality drift (SPI-006)`, `Run \`resync\` before editing: ${digest.driftedFiles.join(', ')}`, '');
  }

  if (digest.blockers.length > 0) {
    lines.push(`### Blockers (${digest.blockers.length})`);
    for (const b of digest.blockers.slice(0, 12)) {
      lines.push(`- [\`${b.findingId}\`] **${b.diagnosticId}** \`${b.location ?? b.filePath}\` — ${b.message}`);
    }
    if (digest.blockers.length > 12) {
      lines.push(`- … and ${digest.blockers.length - 12} more blockers`);
    }
    lines.push('');
  }

  if (digest.recommendedActions.length > 0) {
    lines.push(`### Recommended repair sequence`);
    for (const [i, action] of digest.recommendedActions.slice(0, 8).entries()) {
      const verify = action.verificationCommand ? ` → verify: \`${action.verificationCommand}\`` : '';
      const dir = action.directiveId ? ` (directive \`${action.directiveId}\`)` : '';
      lines.push(`${i + 1}. ${action.action}${dir}${verify}`);
    }
    lines.push('');
  }

  if (digest.playbook.length > 0) {
    lines.push(`### Agent playbook`);
    for (const step of digest.playbook.slice(0, 10)) {
      const cmd = step.command ? ` — \`${step.command}\`` : '';
      lines.push(`${step.step}. [${step.phase}] ${step.instruction}${cmd}`);
    }
    lines.push('');
  }

  if (digest.verdict === 'pass' && digest.blockers.length === 0) {
    lines.push(`No structural blockers detected in scope.`);
  }

  return lines.join('\n');
}

export function buildAgentDigest(report: SpiderReport): SpiderAgentDigest {
  const findings = assignFindingIds(report.findings);
  const verdict = computeVerdict(findings, report.degraded);
  const blockers = findings.filter((f) => f.severity === 'ERROR').map(toFindingRef);
  const warnings = findings.filter((f) => f.severity === 'WARN').map(toFindingRef);

  const counts = { errors: 0, warnings: 0, info: 0, total: findings.length };
  const byDiagnosticId: Partial<Record<SpiderDiagnosticId, number>> = {};
  const byFile: Record<string, { errors: number; warnings: number; info: number }> = {};

  for (const f of findings) {
    if (f.severity === 'ERROR') counts.errors++;
    else if (f.severity === 'WARN') counts.warnings++;
    else counts.info++;

    byDiagnosticId[f.diagnosticId] = (byDiagnosticId[f.diagnosticId] ?? 0) + 1;

    if (!byFile[f.filePath]) byFile[f.filePath] = { errors: 0, warnings: 0, info: 0 };
    if (f.severity === 'ERROR') byFile[f.filePath].errors++;
    else if (f.severity === 'WARN') byFile[f.filePath].warnings++;
    else byFile[f.filePath].info++;
  }

  const driftedFiles = report.diskParity
    .filter((p) => p.driftStatus === 'drifted' || p.driftStatus === 'missing')
    .map((p) => p.filePath);

  const recommendedActions = buildRecommendedActions(findings, report.repairDirectives);
  const playbook = buildPlaybook(report, driftedFiles, report.repairDirectives, blockers);

  let summary: string;
  if (verdict === 'fail') {
    summary = `${counts.errors} blocker(s), ${counts.warnings} warning(s) across ${Object.keys(byFile).length} file(s).`;
  } else if (verdict === 'warn') {
    summary = `No blockers; ${counts.warnings} warning(s)${report.degraded ? ' (degraded audit)' : ''}.`;
  } else {
    summary = `Structural audit clean for scope "${report.scope}".`;
  }

  const digest: SpiderAgentDigest = {
    verdict,
    passed: verdict === 'pass',
    summary,
    counts,
    byDiagnosticId,
    byFile,
    blockers,
    warnings,
    driftedFiles,
    recommendedActions,
    playbook,
    agentNarrative: '',
  };
  digest.agentNarrative = formatAgentNarrative(digest, report);
  return digest;
}

export function enrichSpiderReport(report: SpiderReport): SpiderReport {
  const findings = assignFindingIds(report.findings);
  const agentDigest = buildAgentDigest({ ...report, findings });
  return {
    ...report,
    findings,
    agentDigest,
    passed: agentDigest.passed,
    verdict: agentDigest.verdict,
  };
}

/** Runtime guard — fails closed on untyped or hollow forensic payloads. */
export function validateSpiderReport(report: unknown): asserts report is SpiderReport {
  if (!report || typeof report !== 'object') {
    throw new SpiderAuditError('SpiderReport must be a non-null object');
  }
  const r = report as SpiderReport;
  if (typeof r.reportId !== 'string' || !r.reportId) {
    throw new SpiderAuditError('SpiderReport.reportId is required');
  }
  if (!Array.isArray(r.findings)) {
    throw new SpiderAuditError('SpiderReport.findings must be an array');
  }
  for (const [i, finding] of r.findings.entries()) {
    if (!finding.diagnosticId?.startsWith('SPI-')) {
      throw new SpiderAuditError(`findings[${i}] missing valid diagnosticId`);
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      throw new SpiderAuditError(`findings[${i}] must include typed evidence`);
    }
    for (const [j, ev] of finding.evidence.entries()) {
      if (!ev.observed || !ev.expected || !ev.rationale) {
        throw new SpiderAuditError(`findings[${i}].evidence[${j}] incomplete`);
      }
    }
  }
  for (const [i, d] of (r.repairDirectives ?? []).entries()) {
    if (!d.verificationCommand) {
      throw new SpiderAuditError(`repairDirectives[${i}] missing verificationCommand`);
    }
    if (!d.supportingEvidenceIds?.length) {
      throw new SpiderAuditError(`repairDirectives[${i}] missing supportingEvidenceIds`);
    }
  }
  if (r.typeMirror.compilerAvailable && r.typeMirror.diagnosticsComplete === false && !r.degraded) {
    throw new SpiderAuditError('Report claims compiler truth without degraded flag');
  }
}

export function sortFindingsBySeverity(findings: SpiderFinding[]): SpiderFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.filePath.localeCompare(b.filePath)
  );
}
