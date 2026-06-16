// [LAYER: CORE]
/**
 * Industry-standard export formats for Spider forensic reports.
 * Mirrors SARIF 2.1.0, LSP PublishDiagnostics, ESLint compact, and GitHub Checks conclusions.
 */
import type {
  RepairDirective,
  SpiderAgentBundle,
  SpiderCodeAction,
  SpiderDiagnosticId,
  SpiderDiagnosticJson,
  SpiderFinding,
  SpiderGatePolicy,
  SpiderGateResult,
  SpiderReport,
  SpiderReportDiff,
  SpiderGithubCheckAnnotation,
  SpiderSeverity,
} from './report-types.js';
import { SPI_LABELS } from './report-types.js';
import { stableFindingId, toFindingRef } from './AgentDigest.js';
import { SPI_RULE_DOCS, formatLocationUri } from './spider-constants.js';

export { SPI_RULE_DOCS, formatLocationUri };

const DEFAULT_GATE_POLICY: Required<SpiderGatePolicy> = {
  blockOnErrors: true,
  blockOnWarnings: false,
  blockOnDegraded: false,
  blockOnDrift: true,
};

const severityToSarifLevel = (s: SpiderSeverity): 'error' | 'warning' | 'note' => {
  if (s === 'ERROR') return 'error';
  if (s === 'WARN') return 'warning';
  return 'note';
};

const severityToLsp = (s: SpiderSeverity): number => {
  if (s === 'ERROR') return 1;
  if (s === 'WARN') return 2;
  return 3;
};

export function toCompactLines(report: SpiderReport): string[] {
  const lines: string[] = [];
  for (const finding of report.findings) {
    const ref = toFindingRef(finding);
    const sev = finding.severity.toLowerCase();
    const loc = formatLocationUri(ref.filePath, ref.line, ref.column);
    lines.push(`${loc}: ${sev} ${finding.diagnosticId} (${SPI_LABELS[finding.diagnosticId]}) ${finding.message} [${ref.findingId}]`);
  }
  return lines;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
    };
  }>;
  fingerprints?: { primaryLocationLineHash: string };
  relatedLocations?: Array<{ id: number; physicalLocation: { artifactLocation: { uri: string } } }>;
}

export interface SarifLog {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json';
  version: '2.1.0';
  runs: Array<{
    tool: {
      driver: {
        name: 'broccolidb-spider';
        version: '20.0.0';
        informationUri: string;
        rules: Array<{ id: string; name: string; shortDescription: { text: string }; helpUri: string }>;
      };
    };
    results: SarifResult[];
  }>;
}

export function toSarifLog(report: SpiderReport, workspaceRoot?: string): SarifLog {
  const ruleIds = [...new Set(report.findings.map((f) => f.diagnosticId))];
  const rules = ruleIds.map((id) => ({
    id,
    name: SPI_LABELS[id],
    shortDescription: { text: SPI_LABELS[id] },
    helpUri: SPI_RULE_DOCS[id],
  }));

  const results: SarifResult[] = report.findings.map((finding) => {
    const ref = toFindingRef(finding);
    const range = finding.sourceRange ?? finding.evidence[0]?.sourceRange;
    const uri = workspaceRoot ? `file://${workspaceRoot}/${ref.filePath}` : ref.filePath;
    const result: SarifResult = {
      ruleId: finding.diagnosticId,
      ruleIndex: ruleIds.indexOf(finding.diagnosticId),
      level: severityToSarifLevel(finding.severity),
      message: { text: finding.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            ...(range
              ? {
                  region: {
                    startLine: range.startLine,
                    startColumn: range.startColumn,
                    endLine: range.endLine,
                    endColumn: range.endColumn,
                  },
                }
              : {}),
          },
        },
      ],
      fingerprints: { primaryLocationLineHash: ref.findingId },
    };
    return result;
  });

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'broccolidb-spider',
            version: '20.0.0',
            informationUri: 'https://github.com/CardSorting/AIBroccoliDB',
            rules,
          },
        },
        results,
      },
    ],
  };
}

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  code: string | number;
  source: 'spider';
  message: string;
  relatedInformation?: Array<{ location: { uri: string; range: LspDiagnostic['range'] }; message: string }>;
}

export function toLspDiagnostics(report: SpiderReport, workspaceRoot?: string): Record<string, LspDiagnostic[]> {
  const byUri: Record<string, LspDiagnostic[]> = {};

  for (const finding of report.findings) {
    const range = finding.sourceRange ?? finding.evidence[0]?.sourceRange;
    const uri = workspaceRoot
      ? `file://${workspaceRoot.replace(/\\/g, '/')}/${finding.filePath}`
      : finding.filePath;

    const lspRange = range
      ? {
          start: { line: Math.max(0, range.startLine - 1), character: Math.max(0, range.startColumn - 1) },
          end: { line: Math.max(0, range.endLine - 1), character: Math.max(0, range.endColumn - 1) },
        }
      : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

    const diag: LspDiagnostic = {
      range: lspRange,
      severity: severityToLsp(finding.severity),
      code: finding.diagnosticId,
      source: 'spider',
      message: `[${SPI_LABELS[finding.diagnosticId]}] ${finding.message}`,
    };

    const directive = report.repairDirectives.find((d) =>
      d.supportingEvidenceIds.includes(finding.diagnosticId)
    );
    if (directive) {
      diag.relatedInformation = [
        {
          location: { uri, range: lspRange },
          message: `Repair: ${directive.type} — ${directive.rationale}`,
        },
      ];
    }

    if (!byUri[uri]) byUri[uri] = [];
    byUri[uri].push(diag);
  }

  return byUri;
}

export function evaluateGate(report: SpiderReport, policy: SpiderGatePolicy = {}): SpiderGateResult {
  const p = { ...DEFAULT_GATE_POLICY, ...policy };
  const reasons: string[] = [];
  const digest = report.agentDigest;
  const errorCount = digest?.counts.errors ?? report.findings.filter((f) => f.severity === 'ERROR').length;
  const warnCount = digest?.counts.warnings ?? report.findings.filter((f) => f.severity === 'WARN').length;
  const drifted = digest?.driftedFiles ?? report.diskParity.filter((d) => d.driftStatus !== 'clean').map((d) => d.filePath);

  if (p.blockOnErrors && errorCount > 0) {
    reasons.push(`${errorCount} ERROR finding(s)`);
  }
  if (p.blockOnWarnings && warnCount > 0) {
    reasons.push(`${warnCount} WARNING finding(s)`);
  }
  if (p.blockOnDegraded && report.degraded) {
    reasons.push(`Degraded audit: ${report.degradedReasons.join('; ')}`);
  }
  if (p.blockOnDrift && drifted.length > 0) {
    reasons.push(`Disk drift on: ${drifted.join(', ')}`);
  }

  const blocked = reasons.length > 0;
  let conclusion: SpiderGateResult['conclusion'] = 'success';
  if (blocked) {
    conclusion = errorCount > 0 || (p.blockOnDrift && drifted.length > 0) ? 'failure' : 'neutral';
  } else if (warnCount > 0 || report.degraded) {
    conclusion = 'neutral';
  }

  return {
    blocked,
    conclusion,
    reasons,
    report,
    policy: p,
    exitCode: blocked && conclusion === 'failure' ? 1 : 0,
  };
}

export function diffReports(before: SpiderReport, after: SpiderReport): SpiderReportDiff {
  const beforeIds = new Set(before.findings.map((f) => f.findingId ?? stableFindingId(f)));
  const afterIds = new Set(after.findings.map((f) => f.findingId ?? stableFindingId(f)));

  const resolved = before.findings.filter((f) => !afterIds.has(f.findingId ?? stableFindingId(f)));
  const introduced = after.findings.filter((f) => !beforeIds.has(f.findingId ?? stableFindingId(f)));
  const persistent = after.findings.filter((f) => beforeIds.has(f.findingId ?? stableFindingId(f)));

  return {
    beforeReportId: before.reportId,
    afterReportId: after.reportId,
    resolved: resolved.map(toFindingRef),
    introduced: introduced.map(toFindingRef),
    persistent: persistent.map(toFindingRef),
    entropyDelta: after.entropy - before.entropy,
    verdictChanged: before.verdict !== after.verdict,
    beforeVerdict: before.verdict ?? 'pass',
    afterVerdict: after.verdict ?? 'pass',
  };
}

export function explainFinding(report: SpiderReport, findingId: string): {
  finding: SpiderFinding;
  directives: RepairDirective[];
  ruleDoc: string;
  location: string;
} | null {
  const finding = report.findings.find((f) => (f.findingId ?? stableFindingId(f)) === findingId);
  if (!finding) return null;
  const ref = toFindingRef(finding);
  const directives = report.repairDirectives.filter(
    (d) =>
      d.supportingEvidenceIds.includes(finding.diagnosticId) ||
      d.targetFile === finding.filePath
  );
  return {
    finding,
    directives,
    ruleDoc: SPI_RULE_DOCS[finding.diagnosticId],
    location: formatLocationUri(ref.filePath, ref.line, ref.column),
  };
}

export function toAgentCompact(report: SpiderReport): {
  reportId: string;
  verdict: string;
  passed: boolean;
  summary: string;
  lines: string[];
  playbook: NonNullable<SpiderReport['agentDigest']>['playbook'];
  gate: Pick<SpiderGateResult, 'blocked' | 'conclusion' | 'reasons' | 'exitCode'>;
} {
  const gate = evaluateGate(report);
  return {
    reportId: report.reportId,
    verdict: report.verdict ?? 'pass',
    passed: report.passed ?? gate.conclusion === 'success',
    summary: report.agentDigest?.summary ?? '',
    lines: toCompactLines(report),
    playbook: report.agentDigest?.playbook ?? [],
    gate: {
      blocked: gate.blocked,
      conclusion: gate.conclusion,
      reasons: gate.reasons,
      exitCode: gate.exitCode,
    },
  };
}

const severityToJson = (s: SpiderSeverity): SpiderDiagnosticJson['severity'] => {
  if (s === 'ERROR') return 'error';
  if (s === 'WARN') return 'warning';
  return 'info';
};

const severityToGithub = (s: SpiderSeverity): 'error' | 'warning' | 'notice' => {
  if (s === 'ERROR') return 'error';
  if (s === 'WARN') return 'warning';
  return 'notice';
};

/** ESLint JSON / rustc json_messages style — machine-parseable diagnostics. */
export function toDiagnosticJson(report: SpiderReport): SpiderDiagnosticJson[] {
  return report.findings.map((finding) => {
    const ref = toFindingRef(finding);
    const range = finding.sourceRange ?? finding.evidence[0]?.sourceRange;
    const directive = report.repairDirectives.find((d) =>
      d.supportingEvidenceIds.includes(finding.diagnosticId) && d.targetFile === finding.filePath
    );
    return {
      filePath: ref.filePath,
      line: ref.line ?? 1,
      column: ref.column ?? 1,
      endLine: range?.endLine,
      endColumn: range?.endColumn,
      severity: severityToJson(finding.severity),
      code: finding.diagnosticId,
      message: finding.message,
      findingId: ref.findingId,
      ruleDoc: SPI_RULE_DOCS[finding.diagnosticId],
      ...(directive
        ? {
            fix: {
              description: directive.rationale,
              verificationCommand: directive.verificationCommand ?? '',
            },
          }
        : {}),
    };
  });
}

/** GitHub Actions workflow commands — ::error file=…,line=…::message */
export function toGithubAnnotations(report: SpiderReport): string[] {
  return report.findings.map((finding) => {
    const ref = toFindingRef(finding);
    const level = severityToGithub(finding.severity);
    const loc = `file=${ref.filePath},line=${ref.line ?? 1},col=${ref.column ?? 1}`;
    const title = SPI_LABELS[finding.diagnosticId];
    return `::${level} ${loc},title=${title}::[${finding.diagnosticId}] ${finding.message} (${ref.findingId})`;
  });
}

/** GitHub REST Checks API annotation objects — for createCheckRun payloads. */
export function toGithubCheckAnnotations(report: SpiderReport): SpiderGithubCheckAnnotation[] {
  return report.findings.map((finding) => {
    const ref = toFindingRef(finding);
    const level =
      finding.severity === 'ERROR' ? 'failure' : finding.severity === 'WARN' ? 'warning' : 'notice';
    return {
      path: ref.filePath,
      start_line: ref.line ?? 1,
      end_line: ref.line ?? 1,
      annotation_level: level,
      message: `[${finding.diagnosticId}] ${finding.message}`,
      title: SPI_LABELS[finding.diagnosticId],
      raw_details: ref.findingId,
    };
  });
}

/** LSP CodeAction-shaped quick fixes from repair directives. */
export function toCodeActions(report: SpiderReport): SpiderCodeAction[] {
  const actions: SpiderCodeAction[] = [];
  for (const directive of report.repairDirectives) {
    const finding = report.findings.find(
      (f) =>
        directive.supportingEvidenceIds.includes(f.diagnosticId) &&
        (directive.targetFile === f.filePath || !directive.targetFile)
    );
    actions.push({
      title: `[${directive.type}] ${directive.rationale}`,
      kind: directive.riskLevel === 'high' ? 'refactor' : 'quickfix',
      filePath: directive.targetFile,
      findingId: finding ? (finding.findingId ?? stableFindingId(finding)) : undefined,
      directiveId: directive.directiveId,
      rationale: directive.rationale,
      verificationCommand: directive.verificationCommand ?? '',
      riskLevel: directive.riskLevel,
    });
  }
  return actions;
}

/** Filter a full report to files in scope (batch preflight / neighborhood views). */
export function scopeReportView(report: SpiderReport, filePaths: Iterable<string>): SpiderReport {
  const scope = new Set(filePaths);
  return {
    ...report,
    scope: [...scope].join(','),
    findings: report.findings.filter((f) => scope.has(f.filePath)),
    diskParity: report.diskParity.filter((p) => scope.has(p.filePath)),
    footprints: report.footprints.filter((f) => scope.has(f.currentLocation)),
    repairDirectives: report.repairDirectives.filter((d) => scope.has(d.targetFile)),
  };
}

/** Human-readable PR/session delta narrative. */
export function formatDiffNarrative(diff: SpiderReportDiff): string {
  const lines = [
    `## Spider Delta`,
    `**Before:** ${diff.beforeReportId} (${diff.beforeVerdict}) → **After:** ${diff.afterReportId} (${diff.afterVerdict})`,
    `Resolved: ${diff.resolved.length} | Introduced: ${diff.introduced.length} | Persistent: ${diff.persistent.length} | Entropy Δ: ${diff.entropyDelta >= 0 ? '+' : ''}${diff.entropyDelta.toFixed(3)}`,
    '',
  ];

  if (diff.introduced.length > 0) {
    lines.push(`### Introduced (${diff.introduced.length})`);
    for (const f of diff.introduced.slice(0, 10)) {
      lines.push(`- [${f.findingId}] **${f.diagnosticId}** \`${f.filePath}\` — ${f.message}`);
    }
    if (diff.introduced.length > 10) lines.push(`- … +${diff.introduced.length - 10} more`);
    lines.push('');
  }

  if (diff.resolved.length > 0) {
    lines.push(`### Resolved (${diff.resolved.length})`);
    for (const f of diff.resolved.slice(0, 10)) {
      lines.push(`- [${f.findingId}] **${f.diagnosticId}** \`${f.filePath}\``);
    }
    if (diff.resolved.length > 10) lines.push(`- … +${diff.resolved.length - 10} more`);
    lines.push('');
  }

  if (diff.verdictChanged) {
    lines.push(`> Verdict changed: **${diff.beforeVerdict}** → **${diff.afterVerdict}**`);
  }

  return lines.join('\n');
}

/** GitHub Actions job summary markdown — write to $GITHUB_STEP_SUMMARY. */
export function toGithubStepSummary(
  bundle: Pick<
    SpiderAgentBundle,
    'verdict' | 'gate' | 'clusters' | 'compactLines' | 'nextAction' | 'brief'
  >,
  diagnosticSummary: {
    errors: number;
    warnings: number;
    driftedFiles: number;
  }
): string {
  const lines = [
    '## Spider Forensic Check',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Verdict | **${bundle.verdict}** |`,
    `| Exit code | ${bundle.gate.exitCode} |`,
    `| Conclusion | ${bundle.gate.conclusion} |`,
    `| Errors | ${diagnosticSummary.errors} |`,
    `| Warnings | ${diagnosticSummary.warnings} |`,
    `| Drifted files | ${diagnosticSummary.driftedFiles} |`,
    '',
    `**Next:** ${bundle.nextAction}`,
    '',
  ];

  if (bundle.clusters.length > 0) {
    lines.push('### Root causes', '');
    for (const cluster of bundle.clusters.slice(0, 5)) {
      lines.push(`- **${cluster.cause}** (${cluster.count}) — ${cluster.remediationHint}`);
    }
    lines.push('');
  }

  if (bundle.compactLines.length > 0) {
    lines.push('### Sample diagnostics', '', '```');
    lines.push(...bundle.compactLines.slice(0, 8));
    lines.push('```');
  }

  return lines.join('\n');
}

/** SARIF artifact metadata for GitHub Code Scanning / Azure DevOps upload. */
export function prepareSarifUpload(
  report: SpiderReport,
  workspaceRoot?: string
): {
  artifactName: string;
  sarif: SarifLog;
  exitCode: 0 | 1;
  reportId: string;
} {
  const gate = evaluateGate(report);
  return {
    artifactName: `spider-${report.reportId}.sarif.json`,
    sarif: toSarifLog(report, workspaceRoot),
    exitCode: gate.exitCode,
    reportId: report.reportId,
  };
}

/** TAP (Test Anything Protocol) output for CI harnesses. */
export function toTap(report: SpiderReport): string {
  const lines = ['TAP version 13'];
  const total = report.findings.length;
  const failures = report.findings.filter((f) => f.severity === 'ERROR').length;
  lines.push(`1..${total || 1}`);
  if (total === 0) {
    lines.push('ok 1 - spider structural audit clean');
    return lines.join('\n');
  }
  let i = 1;
  for (const finding of report.findings) {
    const ref = toFindingRef(finding);
    const loc = formatLocationUri(ref.filePath, ref.line, ref.column);
    if (finding.severity === 'ERROR') {
      lines.push(`not ok ${i} - ${finding.diagnosticId} ${loc} [${ref.findingId}]`);
      lines.push(`  ---`);
      lines.push(`  message: ${finding.message}`);
      lines.push(`  severity: error`);
      lines.push(`  ...`);
    } else {
      lines.push(`ok ${i} - ${finding.diagnosticId} ${loc} # ${finding.severity}`);
    }
    i++;
  }
  if (failures > 0) {
    lines.push(`# failed ${failures} of ${total} structural checks`);
  }
  return lines.join('\n');
}

/** JUnit XML for CI dashboards (Jenkins, GitLab, etc.). */
export function toJUnitXml(report: SpiderReport, suiteName = 'spider-structural'): string {
  const cases = report.findings.map((finding) => {
    const ref = toFindingRef(finding);
    const failed = finding.severity === 'ERROR';
    const name = `${finding.diagnosticId} ${ref.filePath}`;
    if (failed) {
      return `    <testcase classname="spider.${finding.diagnosticId}" name="${escapeXml(name)}" time="0">
      <failure message="${escapeXml(finding.message)}" type="${finding.diagnosticId}">[${ref.findingId}] ${escapeXml(finding.message)}</failure>
    </testcase>`;
    }
    return `    <testcase classname="spider.${finding.diagnosticId}" name="${escapeXml(name)}" time="0"/>`;
  });
  const failures = report.findings.filter((f) => f.severity === 'ERROR').length;
  const tests = Math.max(report.findings.length, 1);
  if (report.findings.length === 0) {
    cases.push(`    <testcase classname="spider" name="structural-audit-clean" time="0"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" errors="0" skipped="0">
${cases.join('\n')}
</testsuite>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** NDJSON diagnostic stream — one JSON object per line (rustc/ESLint streaming CI). */
export function toNdjsonDiagnostics(report: SpiderReport): string {
  return toDiagnosticJson(report)
    .map((row) => JSON.stringify(row))
    .join('\n');
}
