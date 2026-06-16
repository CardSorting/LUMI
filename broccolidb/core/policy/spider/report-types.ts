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
  /** Token/diagnostic caps applied to agent bundles from gateBundle / check. */
  bundleBudget?: SpiderBundleBudget;
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

/** Gate + agent bundle in one round-trip (CI + LLM context). */
export interface SpiderGateBundleResult {
  gate: SpiderGateResult;
  bundle: SpiderAgentBundle;
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

export type SpiderCauseKind =
  | 'import-contract'
  | 'type-soundness'
  | 'architectural-risk'
  | 'structural-cycle'
  | 'layer-violation'
  | 'disk-drift'
  | 'semantic-identity'
  | 'unsafe-repair'
  | 'compiler-unavailable'
  | 'graph-staleness';

export interface SpiderCauseCluster {
  cause: SpiderCauseKind;
  label: string;
  diagnosticIds: SpiderDiagnosticId[];
  count: number;
  hasBlockers: boolean;
  findingIds: string[];
  files: string[];
  remediationHint: string;
}

/** GitHub Actions / VS Code problem matcher — capture group indices are numbers. */
export interface SpiderProblemMatcherPattern {
  regexp: string;
  file?: number;
  line?: number;
  column?: number;
  severity?: number;
  code?: number;
  message?: number;
}

export interface SpiderProblemMatcher {
  owner: string;
  pattern: SpiderProblemMatcherPattern[];
}

/** ESLint JSON / rustc --message-format=json style diagnostic record. */
export interface SpiderDiagnosticJson {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  code: SpiderDiagnosticId;
  message: string;
  findingId: string;
  ruleDoc: string;
  fix?: { description: string; verificationCommand: string };
}

export interface SpiderAgentBundle {
  reportId: string;
  verdict: SpiderVerdict;
  proceed: boolean;
  gate: Pick<SpiderGateResult, 'blocked' | 'conclusion' | 'exitCode' | 'reasons'>;
  summary: string;
  /** One-line token budget summary (cargo-check style). */
  brief: string;
  nextAction: string;
  narrative: string;
  compactLines: string[];
  clusters: SpiderCauseCluster[];
  playbook: SpiderPlaybookStep[];
  problemMatchers: SpiderProblemMatcher[];
  formats: {
    sarif: unknown;
    lsp: Record<string, unknown[]>;
    json: SpiderDiagnosticJson[];
    githubAnnotations: string[];
    codeActions: SpiderCodeAction[];
  };
  /** Present when applyBundleBudget truncated payload for token limits. */
  truncation?: SpiderBundleTruncation;
  /** Severity-ranked actionable queue for agents (blockers → repairs → warnings). */
  priorityQueue: SpiderPriorityItem[];
  /** CI pipeline-style steps derived from playbook + gate state. */
  workflow: SpiderWorkflowStep[];
  /** Runnable verification/resync commands derived from priority queue + workflow. */
  suggestedCommands: string[];
}

export interface SpiderPriorityItem {
  rank: number;
  kind: 'blocker' | 'warning' | 'drift' | 'repair';
  findingId?: string;
  directiveId?: string;
  diagnosticId?: SpiderDiagnosticId;
  filePath: string;
  action: string;
  verificationCommand?: string;
}

export interface SpiderWorkflowStep {
  id: string;
  phase: SpiderPlaybookStep['phase'];
  title: string;
  blocking: boolean;
  command?: string;
  findingIds?: string[];
  directiveIds?: string[];
}

export type SpiderCheckPhase = 'pre-edit' | 'post-edit' | 'ci' | 'delta';

/** Agent-portable JSON payload — omits heavy SARIF/LSP for MCP/session transport. */
export interface SpiderBundleWireFormat {
  reportId: string;
  verdict: SpiderVerdict;
  proceed: boolean;
  brief: string;
  nextAction: string;
  summary: string;
  exitCode: 0 | 1;
  agentContext: string;
  workflowSummary: string;
  priorityQueue: SpiderPriorityItem[];
  workflow: SpiderWorkflowStep[];
  suggestedCommands: string[];
  compactLines: string[];
  clusters: SpiderCauseCluster[];
  truncation?: SpiderBundleTruncation;
  gate: Pick<SpiderGateResult, 'blocked' | 'conclusion' | 'exitCode' | 'reasons'>;
  /** Wire schema version — v2 embeds NDJSON stream for session restore. */
  wireSchema?: 'broccolidb.spider.wire/v1' | 'broccolidb.spider.wire/v2';
  /** Check phase that produced this wire (v2). */
  phase?: SpiderCheckPhase;
  /** Embedded NDJSON event stream for streaming CI restore (v2). */
  ndjsonStream?: string;
}

export interface SpiderCheckRequest {
  phase: SpiderCheckPhase;
  filePath?: string;
  filePaths?: string[];
  scope?: SpiderAuditOptions['scope'];
  bundleBudget?: SpiderBundleBudget;
  gatePolicy?: SpiderGatePolicy;
  includeTypes?: boolean;
  includeRepairDirectives?: boolean;
  neighborhoodDepth?: number;
  /** Intent routing (BroccoliDB v25) — propagated to IntentTracer via capability input. */
  correlationId?: string;
  agentId?: string;
  taskId?: string;
}

export interface SpiderCheckResult {
  phase: SpiderCheckPhase;
  proceed: boolean;
  exitCode: 0 | 1;
  bundle?: SpiderAgentBundle;
  gate?: SpiderGateResult;
  sessionDelta?: SpiderSessionDelta;
  baselineComparison?: SpiderBaselineComparison;
  agentContext: string;
  workflowSummary: string;
  workflow: SpiderWorkflowStep[];
  suggestedCommands: string[];
  wire?: SpiderBundleWireFormat;
}

/** Agent handoff payload — context + workflow + v2 wire with optional check envelope. */
export interface SpiderHandoffResult {
  agentContext: string;
  workflowSummary: string;
  workflow: SpiderWorkflowStep[];
  suggestedCommands: string[];
  wire: SpiderBundleWireFormat;
  checkResponse?: SpiderCheckResponse;
}

/** Severity/SPI rollup — mirrors SonarQube issue summary and ESLint stats. */
export interface SpiderDiagnosticSummary {
  totalFindings: number;
  errors: number;
  warnings: number;
  info: number;
  driftedFiles: number;
  byDiagnosticId: Partial<Record<SpiderDiagnosticId, number>>;
  byCause: Record<string, number>;
}

/**
 * Unified check() JSON envelope for MCP, CI, and agent session restore.
 * Schema version: broccolidb.spider.check-response/v1
 */
export interface SpiderCheckResponse {
  $schema: 'broccolidb.spider.check-response/v1';
  phase: SpiderCheckPhase;
  proceed: boolean;
  exitCode: 0 | 1;
  conclusion: SpiderGateResult['conclusion'];
  digest: string;
  agentContext: string;
  workflowSummary: string;
  suggestedCommands: string[];
  wire?: SpiderBundleWireFormat;
  telemetry?: Record<string, unknown>;
  summary: SpiderDiagnosticSummary;
  problemMatchers: SpiderProblemMatcher[];
  ci: {
    githubAnnotations: string[];
    githubStepSummary: string;
    githubCheckRun?: SpiderGithubCheckRun;
    sarif?: {
      artifactName: string;
      reportId: string;
      exitCode: 0 | 1;
    };
  };
}

/** GitHub REST Checks API — create check run payload shape. */
export interface SpiderGithubCheckRun {
  name: string;
  status: 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled';
  output: {
    title: string;
    summary: string;
    text?: string;
    annotations?: SpiderGithubCheckAnnotation[];
  };
}

export interface SpiderGithubCheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
  title?: string;
  raw_details?: string;
}

/** Multi-phase agent/CI pipeline — pre-edit → ci → delta in one round-trip. */
export interface SpiderCheckPipelineRequest extends Omit<SpiderCheckRequest, 'phase'> {
  phases: SpiderCheckPhase[];
  /** Stop after first failing phase (default true). */
  stopOnFailure?: boolean;
}

export interface SpiderCheckPipelineResult {
  exitCode: 0 | 1;
  proceed: boolean;
  phases: SpiderCheckResult[];
  failedPhase?: SpiderCheckPhase;
  response?: SpiderCheckResponse;
}

export interface SpiderBaselineBundleResult extends SpiderBaselineComparison {
  bundle: SpiderAgentBundle;
  agentContext: string;
  workflowSummary: string;
  workflow: SpiderWorkflowStep[];
  suggestedCommands: string[];
}

/** Token budget controls — mirrors clippy/rust-analyzer diagnostic caps. */
export interface SpiderBundleBudget {
  maxCompactLines?: number;
  maxDiagnostics?: number;
  maxClusters?: number;
  maxPlaybookSteps?: number;
}

export interface SpiderBundleTruncation {
  compactLinesOmitted: number;
  diagnosticsOmitted: number;
  clustersOmitted: number;
  playbookStepsOmitted: number;
}

/** LSP CodeAction-shaped quick fixes from repair directives. */
export interface SpiderCodeAction {
  title: string;
  kind: 'quickfix' | 'refactor';
  filePath: string;
  findingId?: string;
  directiveId: string;
  rationale: string;
  verificationCommand: string;
  riskLevel: RepairDirective['riskLevel'];
}

/** Preflight + agent bundle in one payload. */
export interface SpiderPreflightBundleResult extends SpiderPreflightResult {
  bundle: SpiderAgentBundle;
  proceed: boolean;
}

/** Session diff with human-readable narrative. */
export interface SpiderSessionDelta {
  diff: SpiderReportDiff;
  narrative: string;
}

export interface SpiderBatchPreflightResult {
  files: string[];
  mergedScope: string[];
  results: SpiderPreflightResult[];
  audit: SpiderReport;
  bundle: SpiderAgentBundle;
  proceed: boolean;
}

export interface SpiderBaselineComparison {
  baselineReportId: string;
  currentReportId: string;
  diff: SpiderReportDiff;
  entropyDelta: number;
  introducedCount: number;
  resolvedCount: number;
  narrative: string;
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
