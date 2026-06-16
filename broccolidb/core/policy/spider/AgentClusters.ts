// [LAYER: CORE]
import type { SpiderCauseCluster, SpiderDiagnosticId, SpiderReport } from './report-types.js';
import { SPI_LABELS } from './report-types.js';
import * as crypto from 'node:crypto';

function stableFindingId(finding: Pick<SpiderReport['findings'][number], 'diagnosticId' | 'filePath' | 'message' | 'symbolName'>): string {
  const key = [finding.diagnosticId, finding.filePath, finding.symbolName ?? '', finding.message].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

const CAUSE_BY_SPI: Record<SpiderDiagnosticId, SpiderCauseCluster['cause']> = {
  'SPI-001': 'import-contract',
  'SPI-002': 'type-soundness',
  'SPI-003': 'architectural-risk',
  'SPI-004': 'structural-cycle',
  'SPI-005': 'layer-violation',
  'SPI-006': 'disk-drift',
  'SPI-007': 'semantic-identity',
  'SPI-008': 'unsafe-repair',
  'SPI-009': 'compiler-unavailable',
  'SPI-010': 'graph-staleness',
};

export function clusterFindingsByCause(report: SpiderReport): SpiderCauseCluster[] {
  const buckets = new Map<SpiderCauseCluster['cause'], SpiderCauseCluster>();

  for (const finding of report.findings) {
    const cause = CAUSE_BY_SPI[finding.diagnosticId];
    const findingId = finding.findingId ?? stableFindingId(finding);
    const existing = buckets.get(cause);
    if (existing) {
      existing.findingIds.push(findingId);
      existing.count++;
      if (!existing.files.includes(finding.filePath)) existing.files.push(finding.filePath);
      if (finding.severity === 'ERROR') existing.hasBlockers = true;
    } else {
      buckets.set(cause, {
        cause,
        label: SPI_LABELS[finding.diagnosticId],
        diagnosticIds: [finding.diagnosticId],
        count: 1,
        hasBlockers: finding.severity === 'ERROR',
        findingIds: [findingId],
        files: [finding.filePath],
        remediationHint: finding.evidence[0]?.rationale ?? SPI_LABELS[finding.diagnosticId],
      });
    }
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.hasBlockers !== b.hasBlockers) return a.hasBlockers ? -1 : 1;
    return b.count - a.count;
  });
}
