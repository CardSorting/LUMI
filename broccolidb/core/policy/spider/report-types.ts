// [LAYER: CORE]
import type { Layer } from '../../../utils/joy-zoning.js';

export type SpiderDiagnosticId =
  | 'SPI-001'
  | 'SPI-002'
  | 'SPI-003'
  | 'SPI-004'
  | 'SPI-005'
  | 'SPI-006'
  | 'SPI-007'
  | 'SPI-008'
  | 'SPI-009'
  | 'SPI-010';

export const SPI_LABELS: Record<SpiderDiagnosticId, string> = {
  'SPI-001': 'SymbolicContractBreakage',
  'SPI-002': 'TypeSoundnessFailure',
  'SPI-003': 'ArchitecturalVolcano',
  'SPI-004': 'StructuralLoop',
  'SPI-005': 'LayerViolation',
  'SPI-006': 'RealityDrift',
  'SPI-007': 'SemanticIdentityMismatch',
  'SPI-008': 'RepairDirectiveUnsafe',
  'SPI-009': 'CompilerUnavailable',
  'SPI-010': 'GraphStaleness',
};

export type SpiderSeverity = 'ERROR' | 'WARN' | 'INFO';

export type EvidenceKind =
  | 'ast-footprint'
  | 'disk-hash'
  | 'compiler-diagnostic'
  | 'graph-edge'
  | 'import-resolution'
  | 'layer-rule'
  | 'cycle-detection'
  | 'symbol-registry';

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SpiderEvidence {
  diagnosticId: SpiderDiagnosticId;
  severity: SpiderSeverity;
  filePath: string;
  symbolName?: string;
  sourceRange?: SourceRange;
  evidenceKind: EvidenceKind;
  evidenceHash?: string;
  observed: string;
  expected: string;
  rationale: string;
}

export interface SpiderFinding {
  diagnosticId: SpiderDiagnosticId;
  severity: SpiderSeverity;
  label: string;
  filePath: string;
  symbolName?: string;
  sourceRange?: SourceRange;
  evidence: SpiderEvidence[];
  message: string;
}

export type MoveConfidence = 'exact' | 'high' | 'medium' | 'low' | 'none';

export interface SemanticFootprint {
  symbolName: string;
  astNormalizedHash: string;
  signatureHash: string;
  exportIdentity: string;
  importIdentity: string[];
  previousLocation?: string;
  currentLocation: string;
  moveConfidence: MoveConfidence;
  matchReason: string;
}

export type DriftStatus = 'clean' | 'drifted' | 'missing' | 'unknown';

export interface DiskParityResult {
  filePath: string;
  graphHash: string;
  diskHash: string;
  lastIndexedAt: number;
  lastModifiedAt: number;
  driftStatus: DriftStatus;
}

export interface TypeMirrorDiagnostic {
  filePath: string;
  message: string;
  code: number;
  sourceRange?: SourceRange;
  category: string;
}

export interface TypeMirrorResult {
  compilerAvailable: boolean;
  diagnosticsComplete: boolean;
  degradedReason?: string;
  commandUsed?: string;
  tsconfigPath?: string;
  diagnosticCount: number;
  diagnostics: TypeMirrorDiagnostic[];
}

export type RepairDirectiveType =
  | 'UPDATE_IMPORT_PATH'
  | 'ADD_MISSING_EXPORT'
  | 'REMOVE_STALE_IMPORT'
  | 'RENAME_SYMBOL_REFERENCE'
  | 'MOVE_SYMBOL_REFERENCE'
  | 'BREAK_CYCLE_BY_INTERFACE'
  | 'FIX_LAYER_VIOLATION'
  | 'REFRESH_GRAPH_NODE'
  | 'RESYNC_DISK_PARITY';

export type RepairRiskLevel = 'low' | 'medium' | 'high';

export interface RepairDirective {
  directiveId: string;
  type: RepairDirectiveType;
  targetFile: string;
  targetRange?: SourceRange;
  suggestedValue: string;
  rationale: string;
  preconditions: string[];
  verificationCommand?: string;
  riskLevel: RepairRiskLevel;
  supportingEvidenceIds: string[];
}

export interface StructuralViolation {
  diagnosticId: SpiderDiagnosticId;
  filePath: string;
  message: string;
  evidence: SpiderEvidence[];
}

export interface LayerViolation {
  sourceFile: string;
  sourceLayer: Layer;
  targetFile: string;
  targetLayer: Layer;
  importSpecifier: string;
  evidence: SpiderEvidence;
}

export interface CycleFinding {
  cycle: string[];
  evidence: SpiderEvidence;
}

export interface SpiderAuditOptions {
  scope?: 'all' | 'changed-files' | string[];
  includeTypes?: boolean;
  includeRepairDirectives?: boolean;
}

export interface SpiderResyncOptions {
  files: string[];
}

export interface SpiderResyncResult {
  resynced: string[];
  parity: DiskParityResult[];
  directives: RepairDirective[];
}

export interface SpiderHealth {
  pure: true;
  graphNodeCount: number;
  lastAuditAt?: string;
  compilerDelegatedToLsp: true;
}

export interface SpiderReport {
  reportId: string;
  generatedAt: string;
  scope: string;
  health: SpiderHealth;
  typeMirror: TypeMirrorResult;
  footprints: SemanticFootprint[];
  diskParity: DiskParityResult[];
  findings: SpiderFinding[];
  structuralViolations: StructuralViolation[];
  layerViolations: LayerViolation[];
  cycles: CycleFinding[];
  repairDirectives: RepairDirective[];
  entropy: number;
  degraded: boolean;
  degradedReasons: string[];
}
