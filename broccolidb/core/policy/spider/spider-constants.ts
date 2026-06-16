// [LAYER: CORE]
import type { SpiderDiagnosticId } from './report-types.js';

export const SPI_RULE_DOCS: Record<SpiderDiagnosticId, string> = {
  'SPI-001': 'docs/api/repair-directives.md#add_missing_export',
  'SPI-002': 'docs/api/spider-report.md#type-mirror',
  'SPI-003': 'docs/architecture/spider-v20-forensic-engine.md',
  'SPI-004': 'docs/api/repair-directives.md#break_cycle_by_interface',
  'SPI-005': 'docs/api/repair-directives.md#fix_layer_violation',
  'SPI-006': 'docs/api/repair-directives.md#resync_disk_parity',
  'SPI-007': 'docs/api/spider-report.md',
  'SPI-008': 'docs/api/repair-directives.md',
  'SPI-009': 'docs/api/spider-report.md#type-mirror',
  'SPI-010': 'docs/architecture/spider-v20-forensic-engine.md',
};

export function formatLocationUri(filePath: string, line?: number, column?: number): string {
  if (line === undefined) return filePath;
  if (column === undefined) return `${filePath}:${line}`;
  return `${filePath}:${line}:${column}`;
}
