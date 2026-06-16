// [LAYER: CORE]
import { randomUUID } from 'node:crypto';
import type { SpiderEngine } from '../SpiderEngine.js';
import type {
  CycleFinding,
  DiskParityResult,
  LayerViolation,
  RepairDirective,
  RepairDirectiveType,
  SpiderEvidence,
  SpiderFinding,
  StructuralViolation,
} from './report-types.js';
import type { SpiderNode } from './types.js';

const directive = (
  type: RepairDirectiveType,
  targetFile: string,
  suggestedValue: string,
  rationale: string,
  preconditions: string[],
  verificationCommand: string,
  riskLevel: RepairDirective['riskLevel'],
  evidence: SpiderEvidence
): RepairDirective => ({
  directiveId: randomUUID(),
  type,
  targetFile,
  suggestedValue,
  rationale,
  preconditions,
  verificationCommand,
  riskLevel,
  supportingEvidenceIds: [evidence.diagnosticId],
});

export class RepairDirectiveEngine {
  generateRepairDirectives(
    engine: SpiderEngine,
    findings: SpiderFinding[],
    diskParity: DiskParityResult[],
    layerViolations: LayerViolation[],
    cycles: CycleFinding[]
  ): RepairDirective[] {
    const directives: RepairDirective[] = [];

    for (const parity of diskParity) {
      if (parity.driftStatus !== 'drifted' && parity.driftStatus !== 'missing') continue;
      const evidence: SpiderEvidence = {
        diagnosticId: 'SPI-006',
        severity: 'ERROR',
        filePath: parity.filePath,
        evidenceKind: 'disk-hash',
        evidenceHash: parity.diskHash || parity.graphHash,
        observed: parity.diskHash || 'missing',
        expected: parity.graphHash,
        rationale: `Graph hash ${parity.graphHash.slice(0, 8)} does not match disk hash ${(parity.diskHash || 'missing').slice(0, 8)}.`,
      };
      directives.push(
        directive(
          'RESYNC_DISK_PARITY',
          parity.filePath,
          're-read disk bytes and refresh graph node',
          'Disk bytes diverged from indexed graph state; resync restores physical truth before symbolic repair.',
          ['File exists on disk or should be pruned from graph', 'No concurrent writer holds an exclusive lock'],
          `npx tsx -e "require('fs').readFileSync('${parity.filePath}','utf8')"`,
          parity.driftStatus === 'missing' ? 'high' : 'medium',
          evidence
        )
      );
    }

    for (const finding of findings) {
      if (finding.diagnosticId === 'SPI-001' && finding.evidence[0]) {
        const ev = finding.evidence[0];
        directives.push(
          directive(
            'ADD_MISSING_EXPORT',
            finding.filePath,
            finding.symbolName ?? ev.expected,
            'Dependent modules import a symbol that is no longer exported; restoring export repairs the symbolic contract.',
            ['Symbol implementation still exists in module scope', 'Export does not violate layer boundaries'],
            `grep -n "export.*${finding.symbolName ?? ''}" ${finding.filePath}`,
            'medium',
            ev
          )
        );
      }
      if (finding.diagnosticId === 'SPI-004' && finding.evidence[0]) {
        directives.push(
          directive(
            'BREAK_CYCLE_BY_INTERFACE',
            finding.filePath,
            'extract shared interface to neutral layer',
            'Tarjan SCC detected a structural loop; interface extraction inverts dependency direction safely.',
            ['Shared types identified', 'No runtime side effects in extracted interface'],
            `npx tsc --noEmit`,
            'high',
            finding.evidence[0]
          )
        );
      }
    }

    for (const layer of layerViolations) {
      directives.push(
        directive(
          'FIX_LAYER_VIOLATION',
          layer.sourceFile,
          `invert dependency via interface in ${layer.targetLayer} boundary`,
          `${layer.sourceLayer} must not import ${layer.targetLayer} (${layer.importSpecifier}).`,
          ['Target abstraction can be expressed as interface or event', 'Joy-zoning rules remain satisfied'],
          `npx tsc --noEmit`,
          'high',
          layer.evidence
        )
      );
    }

    for (const cycle of cycles) {
      if (directives.some((d) => d.type === 'BREAK_CYCLE_BY_INTERFACE' && cycle.cycle.includes(d.targetFile))) {
        continue;
      }
      directives.push(
        directive(
          'BREAK_CYCLE_BY_INTERFACE',
          cycle.cycle[0],
          'extract shared contract',
          `Cycle ${cycle.cycle.join(' -> ')} requires dependency inversion.`,
          ['Cycle confirmed by graph SCC', 'Interface layer identified'],
          `npx tsc --noEmit`,
          'high',
          cycle.evidence
        )
      );
    }

    this.addImportRepairs(engine, directives);
    return directives;
  }

  private addImportRepairs(engine: SpiderEngine, directives: RepairDirective[]): void {
    const advisories = engine.getIntegrityAdvisories();
    for (const advisory of advisories) {
      if (!advisory.message.includes('GHOST SYMBOL')) continue;
      const match = advisory.message.match(/SYMBOL: (.*?) ->/);
      const symbol = match?.[1];
      if (!symbol) continue;
      const providers = engine.findGlobalProviders(symbol);
      if (providers.length === 0) continue;
      const evidence: SpiderEvidence = {
        diagnosticId: 'SPI-001',
        severity: 'ERROR',
        filePath: advisory.path,
        symbolName: symbol,
        evidenceKind: 'import-resolution',
        observed: `missing export ${symbol}`,
        expected: `import from ${providers[0]}`,
        rationale: `Provider registry locates '${symbol}' at ${providers[0]}.`,
      };
      directives.push(
        directive(
          'UPDATE_IMPORT_PATH',
          advisory.path,
          providers[0],
          `Update import path so '${symbol}' resolves to registered provider.`,
          ['Provider file exports symbol', 'Import specifier is user-controlled'],
          `grep -R "import.*${symbol}" ${advisory.path}`,
          'low',
          evidence
        )
      );
    }
  }

  validateDirectives(directives: RepairDirective[], findings: SpiderFinding[]): RepairDirective[] {
    const evidenceIds = new Set(findings.flatMap((f) => f.evidence.map((e) => e.diagnosticId)));
    return directives.filter((d) => {
      if (d.supportingEvidenceIds.length === 0) return false;
      if (!d.verificationCommand) return false;
      return d.supportingEvidenceIds.some((id) => evidenceIds.has(id as SpiderEvidence['diagnosticId']));
    });
  }
}

export function detectLayerViolations(
  nodes: Map<string, SpiderNode>,
  resolveImport: (source: string, specifier: string) => string | null
): LayerViolation[] {
  const violations: LayerViolation[] = [];

  for (const node of nodes.values()) {
    for (const imp of node.imports) {
      const targetId = resolveImport(node.path, imp);
      if (!targetId) continue;
      const target = nodes.get(targetId);
      if (!target) continue;

      let isViolation = false;
      if (node.layer === 'domain' && (target.layer === 'infrastructure' || target.layer === 'ui')) {
        isViolation = true;
      } else if (node.layer === 'core' && target.layer === 'ui') {
        isViolation = true;
      } else if (node.layer === 'infrastructure' && target.layer === 'ui') {
        isViolation = true;
      } else if (node.layer === 'ui' && target.layer === 'infrastructure') {
        isViolation = true;
      } else if (
        node.layer === 'plumbing' &&
        ['domain', 'core', 'infrastructure', 'ui'].includes(target.layer)
      ) {
        isViolation = true;
      }

      if (!isViolation) continue;

      const evidence: SpiderEvidence = {
        diagnosticId: 'SPI-005',
        severity: 'ERROR',
        filePath: node.path,
        evidenceKind: 'layer-rule',
        observed: `${node.layer} -> ${target.layer}`,
        expected: 'layer-compliant dependency direction',
        rationale: `Joy-zoning forbids ${node.layer} importing ${target.layer} via '${imp}'.`,
      };

      violations.push({
        sourceFile: node.path,
        sourceLayer: node.layer,
        targetFile: target.path,
        targetLayer: target.layer,
        importSpecifier: imp,
        evidence,
      });
    }
  }

  return violations;
}

export function detectCycles(engine: SpiderEngine): CycleFinding[] {
  return engine.detectCycles().map((cycle) => ({
    cycle,
    evidence: {
      diagnosticId: 'SPI-004',
      severity: 'ERROR',
      filePath: cycle[0],
      evidenceKind: 'cycle-detection',
      observed: cycle.join(' -> '),
      expected: 'acyclic module graph',
      rationale: "Tarjan's SCC identified a structural import loop.",
    },
  }));
}

export function violationsToFindings(
  structural: StructuralViolation[],
  layerViolations: LayerViolation[],
  cycles: CycleFinding[],
  diskParity: DiskParityResult[]
): SpiderFinding[] {
  const findings: SpiderFinding[] = [];

  for (const v of structural) {
    findings.push({
      diagnosticId: v.diagnosticId,
      severity: v.evidence[0]?.severity ?? 'ERROR',
      label: v.diagnosticId,
      filePath: v.filePath,
      evidence: v.evidence,
      message: v.message,
    });
  }

  for (const layer of layerViolations) {
    findings.push({
      diagnosticId: 'SPI-005',
      severity: 'ERROR',
      label: 'SPI-005',
      filePath: layer.sourceFile,
      evidence: [layer.evidence],
      message: `Layer violation: ${layer.sourceLayer} imports ${layer.targetLayer} (${layer.targetFile}).`,
    });
  }

  for (const cycle of cycles) {
    findings.push({
      diagnosticId: 'SPI-004',
      severity: 'ERROR',
      label: 'SPI-004',
      filePath: cycle.cycle[0],
      evidence: [cycle.evidence],
      message: `Structural loop: ${cycle.cycle.join(' -> ')}`,
    });
  }

  for (const parity of diskParity) {
    if (parity.driftStatus === 'clean') continue;
    findings.push({
      diagnosticId: 'SPI-006',
      severity: parity.driftStatus === 'missing' ? 'ERROR' : 'WARN',
      label: 'SPI-006',
      filePath: parity.filePath,
      evidence: [
        {
          diagnosticId: 'SPI-006',
          severity: parity.driftStatus === 'missing' ? 'ERROR' : 'WARN',
          filePath: parity.filePath,
          evidenceKind: 'disk-hash',
          evidenceHash: parity.diskHash || parity.graphHash,
          observed: parity.diskHash || 'missing',
          expected: parity.graphHash,
          rationale: `Drift status: ${parity.driftStatus}.`,
        },
      ],
      message: `Reality drift (${parity.driftStatus}) for ${parity.filePath}.`,
    });
  }

  return findings;
}
