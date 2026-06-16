// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SpiderEngine } from '../SpiderEngine.js';
import { DiskParityEngine } from './DiskParityEngine.js';
import { FootprintEngine } from './FootprintEngine.js';
import {
  detectCycles,
  detectLayerViolations,
  RepairDirectiveEngine,
  violationsToFindings,
} from './RepairDirectiveEngine.js';
import type {
  CycleFinding,
  DiskParityResult,
  LayerViolation,
  SpiderAuditOptions,
  SpiderFinding,
  SpiderHealth,
  SpiderReport,
  SpiderResyncOptions,
  SpiderResyncResult,
  StructuralViolation,
} from './report-types.js';
import { SPI_LABELS } from './report-types.js';
import { TypeMirrorEngine } from './TypeMirrorEngine.js';
import {
  enrichSpiderReport,
  sortFindingsBySeverity,
  validateSpiderReport,
} from './AgentDigest.js';

export interface PhysicalFile {
  filePath: string;
  content: string;
  mtimeMs: number;
  diskHash: string;
}

/**
 * ForensicSpider: typed, staged structural audit pipeline.
 * Pure orchestrator — no constructor side effects, no file mutation during audit.
 */
export class ForensicSpider {
  private readonly footprintEngine = new FootprintEngine();
  private readonly diskParityEngine: DiskParityEngine;
  private readonly typeMirrorEngine: TypeMirrorEngine;
  private readonly repairEngine = new RepairDirectiveEngine();
  private lastAuditAt?: string;
  private previousFootprintLocations = new Map<string, string>();

  constructor(
    private readonly engine: SpiderEngine,
    private readonly cwd: string
  ) {
    this.diskParityEngine = new DiskParityEngine(cwd);
    this.typeMirrorEngine = new TypeMirrorEngine(cwd);
  }

  health(): SpiderHealth {
    return {
      pure: true,
      graphNodeCount: this.engine.nodes.size,
      lastAuditAt: this.lastAuditAt,
      compilerDelegatedToLsp: true,
    };
  }

  scanPhysicalFiles(scope?: Set<string>): PhysicalFile[] {
    const files: PhysicalFile[] = [];
    const seen = new Set<string>();
    const candidates = scope
      ? Array.from(scope)
      : Array.from(this.engine.nodes.keys());

    for (const filePath of candidates) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const absolutePath = path.resolve(this.cwd, filePath);
      if (!fs.existsSync(absolutePath)) continue;
      const stats = fs.statSync(absolutePath);
      const content = fs.readFileSync(absolutePath, 'utf-8');
      files.push({
        filePath,
        content,
        mtimeMs: stats.mtimeMs,
        diskHash: this.diskParityEngine.hashFileContent(content),
      });
    }
    return files;
  }

  buildSymbolIndex(files: PhysicalFile[]): void {
    for (const file of files) {
      this.engine.updateNode(file.filePath, file.content, true);
    }
    this.engine.resolveAllImports();
  }

  computeSemanticFootprints(files: PhysicalFile[]) {
    const contentByPath = new Map(files.map((f) => [f.filePath, f.content]));
    const footprints = this.footprintEngine.computeFootprints(
      this.engine.nodes,
      contentByPath,
      this.previousFootprintLocations
    );
    for (const fp of footprints) {
      this.previousFootprintLocations.set(fp.exportIdentity, fp.currentLocation);
    }
    return footprints;
  }

  verifyDiskParity(scope?: Set<string>) {
    return this.diskParityEngine.verifyDiskParity(this.engine.nodes, scope);
  }

  runTypeMirror(scope?: Set<string>, includeTypes = true) {
    if (!includeTypes) {
      return {
        compilerAvailable: false,
        diagnosticsComplete: false,
        degradedReason: 'Type mirror skipped by audit options (includeTypes=false).',
        diagnosticCount: 0,
        diagnostics: [],
      };
    }
    return this.typeMirrorEngine.runTypeMirror(scope);
  }

  detectStructuralViolations(scope?: Set<string>): StructuralViolation[] {
    const violations: StructuralViolation[] = [];
    const allViolations = this.engine.getViolations();

    for (const v of allViolations) {
      const diagnosticId = this.normalizeDiagnosticId(v.id);
      if (!diagnosticId) continue;
      if (scope && !scope.has(v.path) && v.path !== 'SUBSTRATE' && v.path !== 'PROJECT_ROOT') continue;

      violations.push({
        diagnosticId,
        filePath: v.path,
        message: v.message,
        evidence: [
          {
            diagnosticId,
            severity: v.severity,
            filePath: v.path,
            evidenceKind: this.evidenceKindFor(diagnosticId),
            observed: v.message,
            expected: v.remediation ?? 'structural compliance',
            rationale: SPI_LABELS[diagnosticId],
          },
        ],
      });
    }

    const advisories = this.engine.getIntegrityAdvisories();
    for (const advisory of advisories) {
      if (scope && !scope.has(advisory.path)) continue;
      const diagnosticId = advisory.id.startsWith('SPI-102') || advisory.message.includes('GHOST SYMBOL')
        ? 'SPI-001'
        : advisory.id.startsWith('SPI-104')
          ? 'SPI-004'
          : this.normalizeDiagnosticId(advisory.id);
      if (!diagnosticId) continue;

      violations.push({
        diagnosticId,
        filePath: advisory.path,
        message: advisory.message,
        evidence: [
          {
            diagnosticId,
            severity: advisory.severity,
            filePath: advisory.path,
            evidenceKind: 'import-resolution',
            observed: advisory.message,
            expected: 'resolved import/export contract',
            rationale: SPI_LABELS[diagnosticId],
          },
        ],
      });
    }

    return violations;
  }

  generateRepairDirectives(
    findings: SpiderFinding[],
    diskParity: DiskParityResult[],
    layerViolations: LayerViolation[],
    cycles: CycleFinding[],
    includeRepairDirectives: boolean
  ) {
    if (!includeRepairDirectives) return [];
    const directives = this.repairEngine.generateRepairDirectives(
      this.engine,
      findings,
      diskParity,
      layerViolations,
      cycles
    );
    return this.repairEngine.validateDirectives(directives, findings);
  }

  emitForensicReport(report: Omit<SpiderReport, 'reportId' | 'generatedAt'>): SpiderReport {
    return {
      reportId: randomUUID(),
      generatedAt: new Date().toISOString(),
      ...report,
    };
  }

  resolveScope(
    options: SpiderAuditOptions = {}
  ): { scopeLabel: string; scopeSet?: Set<string> } {
    if (!options.scope || options.scope === 'all') {
      return { scopeLabel: 'all' };
    }
    if (options.scope === 'changed-files') {
      const changed = new Set<string>();
      for (const node of this.engine.nodes.values()) {
        const absolutePath = path.resolve(this.cwd, node.path);
        if (!fs.existsSync(absolutePath)) {
          changed.add(node.path);
          continue;
        }
        const stats = fs.statSync(absolutePath);
        if (stats.mtimeMs > (node.mtime ?? 0)) {
          changed.add(node.path);
        }
      }
      return { scopeLabel: 'changed-files', scopeSet: changed };
    }
    if (Array.isArray(options.scope)) {
      const depth = options.neighborhoodDepth ?? 1;
      const expanded = new Set<string>();
      for (const file of options.scope) {
        const norm = this.engine.normalizePath(file);
        expanded.add(norm);
        if (depth > 0) {
          for (const id of this.engine.getNeighborhood(norm, depth)) {
            expanded.add(id);
          }
        }
      }
      return { scopeLabel: options.scope.join(','), scopeSet: expanded };
    }
    return { scopeLabel: String(options.scope) };
  }

  async audit(options: SpiderAuditOptions = {}): Promise<SpiderReport> {
    const { scopeLabel, scopeSet } = this.resolveScope(options);
    const physicalFiles = this.scanPhysicalFiles(scopeSet);
    this.buildSymbolIndex(physicalFiles);
    const footprints = this.computeSemanticFootprints(physicalFiles);
    const diskParity = this.verifyDiskParity(scopeSet);
    const typeMirror = this.runTypeMirror(scopeSet, options.includeTypes !== false);
    const structuralViolations = this.detectStructuralViolations(scopeSet);
    const layerViolations = detectLayerViolations(this.engine.nodes, (source, specifier) =>
      this.engine.resolveImportToNodeId(source, specifier)
    );
    const cycles = detectCycles(this.engine);
    const findings = violationsToFindings(structuralViolations, layerViolations, cycles, diskParity);

    if (!typeMirror.compilerAvailable || !typeMirror.diagnosticsComplete) {
      findings.push({
        diagnosticId: 'SPI-009',
        severity: 'WARN',
        label: 'SPI-009',
        filePath: 'PROJECT_ROOT',
        evidence: [
          {
            diagnosticId: 'SPI-009',
            severity: 'WARN',
            filePath: 'PROJECT_ROOT',
            evidenceKind: 'compiler-diagnostic',
            observed: typeMirror.degradedReason ?? 'compiler unavailable',
            expected: 'complete compiler diagnostics',
            rationale: SPI_LABELS['SPI-009'],
          },
        ],
        message: typeMirror.degradedReason ?? 'Compiler truth not verified.',
      });
    } else {
      for (const diag of typeMirror.diagnostics) {
        if (scopeSet && !scopeSet.has(diag.filePath)) continue;
        findings.push({
          diagnosticId: 'SPI-002',
          severity: 'ERROR',
          label: 'SPI-002',
          filePath: diag.filePath,
          sourceRange: diag.sourceRange,
          evidence: [
            {
              diagnosticId: 'SPI-002',
              severity: 'ERROR',
              filePath: diag.filePath,
              sourceRange: diag.sourceRange,
              evidenceKind: 'compiler-diagnostic',
              observed: diag.message,
              expected: 'type-safe program',
              rationale: SPI_LABELS['SPI-002'],
            },
          ],
          message: diag.message,
        });
      }
    }

    for (const fp of footprints) {
      if (fp.moveConfidence === 'high' && fp.previousLocation && fp.previousLocation !== fp.currentLocation) {
        findings.push({
          diagnosticId: 'SPI-007',
          severity: 'INFO',
          label: 'SPI-007',
          filePath: fp.currentLocation,
          symbolName: fp.symbolName,
          evidence: [
            {
              diagnosticId: 'SPI-007',
              severity: 'INFO',
              filePath: fp.currentLocation,
              symbolName: fp.symbolName,
              evidenceKind: 'ast-footprint',
              evidenceHash: fp.astNormalizedHash,
              observed: fp.currentLocation,
              expected: fp.previousLocation,
              rationale: fp.matchReason,
            },
          ],
          message: `Semantic identity match for '${fp.symbolName}': ${fp.matchReason}`,
        });
      }
    }

    const repairDirectives = this.generateRepairDirectives(
      findings,
      diskParity,
      layerViolations,
      cycles,
      options.includeRepairDirectives === true
    );

    const degradedReasons: string[] = [];
    if (!typeMirror.compilerAvailable || !typeMirror.diagnosticsComplete) {
      degradedReasons.push(typeMirror.degradedReason ?? 'Compiler unavailable');
    }
    if (diskParity.some((p) => p.driftStatus === 'drifted' || p.driftStatus === 'missing')) {
      degradedReasons.push('Disk parity drift detected');
    }

    const entropyReport = this.engine.computeEntropy();
    this.lastAuditAt = new Date().toISOString();

    const baseReport = this.emitForensicReport({
      scope: scopeLabel,
      health: this.health(),
      typeMirror,
      footprints,
      diskParity,
      findings: sortFindingsBySeverity(findings),
      structuralViolations,
      layerViolations,
      cycles,
      repairDirectives,
      entropy: entropyReport.score,
      degraded: degradedReasons.length > 0,
      degradedReasons,
    });

    const includeDigest = options.includeAgentDigest !== false;
    const report = includeDigest ? enrichSpiderReport(baseReport) : baseReport;
    validateSpiderReport(report);
    return report;
  }

  async preflight(
    filePath: string,
    options: Omit<SpiderAuditOptions, 'scope'> = {}
  ): Promise<{ scope: string[]; audit: SpiderReport }> {
    const norm = this.engine.normalizePath(filePath);
    const depth = options.neighborhoodDepth ?? 1;
    const scope = Array.from(this.engine.getNeighborhood(norm, depth));
    if (!scope.includes(norm)) scope.unshift(norm);
    const audit = await this.audit({
      ...options,
      scope,
      includeRepairDirectives: options.includeRepairDirectives ?? true,
      includeAgentDigest: options.includeAgentDigest ?? true,
    });
    return { scope, audit };
  }

  async resync(options: SpiderResyncOptions): Promise<SpiderResyncResult> {
    const resynced: string[] = [];
    for (const filePath of options.files) {
      const absolutePath = path.resolve(this.cwd, filePath);
      if (!fs.existsSync(absolutePath)) {
        this.engine.removeNode(filePath);
        resynced.push(filePath);
        continue;
      }
      const content = fs.readFileSync(absolutePath, 'utf-8');
      this.engine.updateNode(filePath, content);
      resynced.push(filePath);
    }
    this.engine.resolveAllImports();
    const parity = this.verifyDiskParity(new Set(options.files));
    const drifted = parity.filter((p) => p.driftStatus !== 'clean');
    const directives = drifted.map((p) => ({
      directiveId: randomUUID(),
      type: 'REFRESH_GRAPH_NODE' as const,
      targetFile: p.filePath,
      suggestedValue: 're-index from disk',
      rationale: `Resync graph node after disk parity drift (${p.driftStatus}).`,
      preconditions: ['Disk file readable', 'Audit lock not held'],
      verificationCommand: `npx tsc --noEmit`,
      riskLevel: 'low' as const,
      supportingEvidenceIds: ['SPI-006'],
    }));
    return { resynced, parity, directives };
  }

  private normalizeDiagnosticId(id: string) {
    const allowed = [
      'SPI-001',
      'SPI-002',
      'SPI-003',
      'SPI-004',
      'SPI-005',
      'SPI-006',
      'SPI-007',
      'SPI-008',
      'SPI-009',
      'SPI-010',
    ] as const;
    if ((allowed as readonly string[]).includes(id)) return id as (typeof allowed)[number];
    if (id === 'SPI-101' || id === 'SPI-102') return 'SPI-001' as const;
    if (id === 'SPI-104') return 'SPI-004' as const;
    if (id === 'SPI-202' || id === 'SPI-203') return 'SPI-003' as const;
    return null;
  }

  private evidenceKindFor(id: string) {
    switch (id) {
      case 'SPI-002':
        return 'compiler-diagnostic' as const;
      case 'SPI-004':
        return 'cycle-detection' as const;
      case 'SPI-005':
        return 'layer-rule' as const;
      case 'SPI-006':
        return 'disk-hash' as const;
      case 'SPI-007':
        return 'ast-footprint' as const;
      default:
        return 'graph-edge' as const;
    }
  }
}
