// [LAYER: CORE]
/**
 * Industry-standard export formats for Spider forensic reports.
 * Mirrors SARIF 2.1.0, LSP PublishDiagnostics, ESLint compact, and GitHub Checks conclusions.
 */
import type {
  RepairDirective,
  SpiderDiagnosticId,
  SpiderFinding,
  SpiderGatePolicy,
  SpiderGateResult,
  SpiderReport,
  SpiderReportDiff,
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
