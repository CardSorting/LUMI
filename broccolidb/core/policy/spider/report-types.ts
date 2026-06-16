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
  evidenceId?: string;
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
  findingId?: string;
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
  /** Include files within N import hops of scoped files (default 1 for explicit file scopes). */
  neighborhoodDepth?: number;
  includeTypes?: boolean;
  includeRepairDirectives?: boolean;
  /** Attach SARIF-style agent digest with verdict, blockers, and narrative (default true). */
  includeAgentDigest?: boolean;
  /** CI gate policy when using gate() — defaults to block on errors + drift. */
  gatePolicy?: SpiderGatePolicy;
}

export interface SpiderGatePolicy {
  blockOnErrors?: boolean;
  blockOnWarnings?: boolean;
  blockOnDegraded?: boolean;
  blockOnDrift?: boolean;
}

export interface SpiderGateResult {
  blocked: boolean;
  conclusion: 'success' | 'failure' | 'neutral';
  reasons: string[];
  report: SpiderReport;
  policy: Required<SpiderGatePolicy>;
  /** Process exit semantics (0 = proceed, 1 = hard block). */
  exitCode: 0 | 1;
}

export interface SpiderPlaybookStep {
  step: number;
  phase: 'resync' | 'repair' | 'verify' | 'investigate';
  instruction: string;
  command?: string;
  findingIds?: string[];
  directiveIds?: string[];
}

export interface SpiderReportDiff {
  beforeReportId: string;
  afterReportId: string;
  resolved: Array<{ findingId: string; diagnosticId: SpiderDiagnosticId; filePath: string; message: string }>;
  introduced: Array<{ findingId: string; diagnosticId: SpiderDiagnosticId; filePath: string; message: string }>;
  persistent: Array<{ findingId: string; diagnosticId: SpiderDiagnosticId; filePath: string; message: string }>;
  entropyDelta: number;
  verdictChanged: boolean;
  beforeVerdict: SpiderVerdict;
  afterVerdict: SpiderVerdict;
}

export interface SpiderPreflightOptions {
  filePath: string;
  neighborhoodDepth?: number;
  includeTypes?: boolean;
  includeRepairDirectives?: boolean;
}

export interface SpiderPreflightResult {
  filePath: string;
  scope: string[];
  structuralImpact: {
    summary: string;
    blastRadius: {
      affectedNodes: string[];
      centralityScore: number;
      criticalDependents: string[];
    };
    deficiencies: Array<{
      depId: string;
      symbols: string[];
      displacements: { symbol: string; newPath: string }[];
      directives: RepairDirective[];
      line: number;
      character: number;
    }>;
  };
  studyPack: {
    path: string;
    studyItems: { path: string; reason: string }[];
  };
  audit: SpiderReport;
}

export type SpiderVerdict = 'pass' | 'warn' | 'fail';

export interface SpiderAgentDigest {
  verdict: SpiderVerdict;
  passed: boolean;
  summary: string;
  counts: { errors: number; warnings: number; info: number; total: number };
  byDiagnosticId: Partial<Record<SpiderDiagnosticId, number>>;
  byFile: Record<string, { errors: number; warnings: number; info: number }>;
  blockers: Array<{
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
  }>;
  warnings: Array<{
    findingId: string;
    diagnosticId: SpiderDiagnosticId;
    label: string;
    severity: SpiderSeverity;
    filePath: string;
    message: string;
    location?: string;
  }>;
  driftedFiles: string[];
  recommendedActions: Array<{
    priority: number;
    action: string;
    directiveId?: string;
    diagnosticId: SpiderDiagnosticId;
    filePath: string;
    verificationCommand?: string;
    riskLevel?: RepairRiskLevel;
  }>;
  /** Ordered agent checklist (resync → repair → verify). */
  playbook: SpiderPlaybookStep[];
  agentNarrative: string;
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
  /** Gate for agents — false when ERROR findings or hard drift block progress. */
  passed?: boolean;
  verdict?: SpiderVerdict;
  /** Machine + LLM-friendly summary (present when includeAgentDigest !== false). */
  agentDigest?: SpiderAgentDigest;
}
