import * as path from 'node:path';
import type { SpiderEngine } from '../policy/SpiderEngine.js';

export interface BlastRadius {
  affectedNodes: string[];
  centralityScore: number;
  criticalDependents: string[];
  traceback?: Record<string, string[]>; // depId -> symbols used
}

/**
 * StructuralDiscoveryService: Provides high-level architectural insights
 * based on the Spider structural graph.
 */
export class StructuralDiscoveryService {
  private cache: Map<string, BlastRadius> = new Map();
  private inverseGraph: Map<string, Set<string>> = new Map();
  private lastVersion = -1;

  constructor(private getEngine: () => SpiderEngine) {}

  /**
   * Clears the analysis cache.
   */
  public clearCache() {
    this.cache.clear();
  }

  /**
   * Identifies all nodes that depend (directly or indirectly) on the given file.
   */
  public getBlastRadius(filePath: string): BlastRadius {
    const engine = this.getEngine();
    const relativePath = engine.normalizePath(filePath);

    const cached = this.cache.get(relativePath);
    if (cached) return cached;

    const targetNode = engine.nodes.get(relativePath);
    if (!targetNode) {
      return { affectedNodes: [], centralityScore: 0, criticalDependents: [], traceback: {} };
    }

    const dependents: Set<string> = new Set();

    // Recompute inverse graph incrementally if engine version has changed
    if (engine.version !== this.lastVersion) {
      this.inverseGraph = new Map();
      for (const node of engine.nodes.values()) {
        for (const resolved of node.resolvedImports.values()) {
            const existing = this.inverseGraph.get(resolved) || new Set();
            existing.add(node.id);
            this.inverseGraph.set(resolved, existing);
        }
      }
      this.lastVersion = engine.version;
      this.cache.clear(); 
    }

    const visited = new Set<string>();
    const toVisit = [targetNode.id];
    while (toVisit.length > 0) {
      const current = toVisit.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const sources = this.inverseGraph.get(current) || [];
      for (const s of sources) {
        dependents.add(s);
        toVisit.push(s);
      }
    }

    const affectedNodes = Array.from(dependents);
    const criticalDependents = affectedNodes.filter((id) => {
      const n = engine.nodes.get(id);
      return n && (n.layer === 'core' || n.layer === 'ui');
    });

    const result: BlastRadius = {
      affectedNodes,
      centralityScore: affectedNodes.length / Math.max(1, engine.nodes.size),
      criticalDependents,
      traceback: this.buildSymbolTraceback(relativePath, affectedNodes)
    };

    this.cache.set(relativePath, result);
    return result;
  }

  private buildSymbolTraceback(sourcePath: string, dependents: string[]): Record<string, string[]> {
      const engine = this.getEngine();
      const registry = engine.getRegistry();
      const exports = registry.getExports(sourcePath).map(e => e.symbolName);
      const traceback: Record<string, string[]> = {};

      for (const depId of dependents) {
          traceback[depId] = exports;
      }
      return traceback;
  }

  /**
   * Identifies symbols that are imported by other files but no longer 
   * provided by any node in the graph.
   * Anchors on real imports and real symbol providers.
   */
  public getDeficiencyReport(filePath: string): { 
      depId: string, 
      symbols: string[], 
      displacements: { symbol: string, newPath: string }[], 
      directives: any[], // RepairDirective[]
      line: number, 
      character: number 
  }[] {
    const engine = this.getEngine();
    const registry = engine.getRegistry();
    const radius = this.getBlastRadius(filePath);
    const report: { 
        depId: string, 
        symbols: string[], 
        displacements: { symbol: string, newPath: string }[],
        directives: any[], // RepairDirective[]
        line: number, 
        character: number 
    }[] = [];

    const normalizedTarget = engine.normalizePath(filePath);
    const remainingSymbols = new Set(registry.getExports(normalizedTarget).map(s => s.symbolName));

    for (const depId of radius.affectedNodes) {
        const depNode = engine.nodes.get(depId);
        if (!depNode) continue;

        for (const imp of depNode.imports) {
            const resolved = depNode.resolvedImports.get(imp.specifier);
            if (resolved === normalizedTarget) {
                // Determine WHICH symbols are missing
                const missing = imp.symbols.filter(s => !remainingSymbols.has(s));
                
                // For each missing symbol, check if it has "Displaced" elsewhere in the project reality
                const realMissing: string[] = [];
                const displacementSuggestions: { symbol: string, newPath: string }[] = [];
                const directives: any[] = []; // RepairDirective[]

                for (const s of missing) {
                    const providers = registry.findProviders(s);
                    if (providers.length > 0) {
                        const newPath = providers[0];
                        displacementSuggestions.push({ symbol: s, newPath });
                        directives.push({
                            action: 'UPDATE_IMPORT_PATH',
                            symbol: s,
                            suggestedValue: newPath,
                            rationale: `Symbol '${s}' was moved to '${newPath}'. Update import specifier to restore link.`
                        });
                    } else {
                        realMissing.push(s);
                        directives.push({
                            action: 'EXPORT_SYMBOL',
                            symbol: s,
                            rationale: `Symbol '${s}' is no longer exported by '${normalizedTarget}'. Ensure it is exported or update references.`
                        });
                    }
                }

                // If the import was a wildcard or specific symbols are REAL missing
                if (realMissing.length > 0 || displacementSuggestions.length > 0 || (imp.symbols.length === 0 && remainingSymbols.size === 0)) {
                    report.push({
                        depId,
                        symbols: realMissing.length > 0 ? realMissing : [],
                        displacements: displacementSuggestions,
                        directives,
                        line: imp.line,
                        character: imp.character
                    });
                }
            }
        }
    }
    return report;
  }

  /**
   * Summarizes the architectural importance of a file, combining centrality and vitality.
   */
  public getImportanceSummary(filePath: string): string {
    const engine = this.getEngine();
    const path = engine.normalizePath(filePath);
    const node = engine.nodes.get(path);
    const radius = this.getBlastRadius(filePath);
    
    const isVital = (node?.vitality ?? 0) > 50; // Arbitrary high-churn threshold
    const isCentral = radius.centralityScore > 0.2;

    if (isCentral && isVital) {
        return `🔥 ARCHITECTURAL VOLCANO: This is a central hub with EXTREME CHURN. Changes here are historically volatile and have a MASSIVE blast radius (${radius.affectedNodes.length} nodes).`;
    }
    if (isCentral) {
      return `🏗️  STRUCTURAL PILLAR: High centrality (${(radius.centralityScore * 100).toFixed(1)}%). Core logic rests here. Changes require verifying ${radius.affectedNodes.length} dependents.`;
    }
    if (isVital) {
        return `⚡ DYNAMIC SECTOR: Moderate blast radius, but very high modification frequency. Monitor for regression.`;
    }
    if (radius.affectedNodes.length > 0) {
      return `📍 COMPONENT: Focused scope. ${radius.affectedNodes.length} components depend on this file.`;
    }
    return `🍃 LEAF: Zero incoming dependencies. Low-risk isolation.`;
  }
}
