// [LAYER: CORE]
import * as path from 'node:path';
import type { SpiderEngine } from './SpiderEngine.js';

export interface RefactoringSuggestion {
  type: 'RENAME' | 'MOVE' | 'EXTRACT' | 'DELETE' | 'DECOUPLE' | 'SQUASH_CYCLE';
  target: string;
  reason: string;
  benefit: string;
}

/**
 * SpiderRefactorer: Analyzes the Spider graph to identify architectural improvements.
 */
export class SpiderRefactorer {
  constructor(private engine: SpiderEngine) {}

  public getRefactoringSuggestions(): RefactoringSuggestion[] {
    const suggestions: RefactoringSuggestion[] = [];

    // 1. Identify Orphan Nodes
    for (const node of this.engine.nodes.values()) {
      if (node.orphaned && !node.path.includes('index') && !node.path.includes('main')) {
        suggestions.push({
          type: 'DELETE',
          target: node.path,
          reason: 'No incoming dependencies detected in the architectural graph.',
          benefit: 'Reduces codebase entropy and cognitive load.',
        });
      }
    }

    // 2. Identify Layer Violations & Cycles
    const violations = this.engine.getViolations();
    for (const v of violations) {
      if (v.severity === 'ERROR') {
          if (v.id === 'SPI-004' && v.cycle) {
            suggestions.push({
                type: 'SQUASH_CYCLE',
                target: v.path,
                reason: `Detected structural loop: ${v.cycle.join(' -> ')}`,
                benefit: 'Removes circularity, simplifying mental model and build parallelization.'
            });
          } else {
            suggestions.push({
                type: 'MOVE',
                target: v.path,
                reason: v.message,
                benefit: 'Restores architectural integrity and prevents cross-layer pollution.',
            });
          }
      }
    }

    // 3. Strategic Decoupling (Symbol-based)
    // If a node imports many concrete symbols from a different layer, suggest decoupling
    for (const node of this.engine.nodes.values()) {
        const registry = this.engine.getRegistry();
        let concreteCount = 0;
        
        for (const resolved of node.resolvedImports.values()) {
            const targetNode = this.engine.nodes.get(resolved);
            if (targetNode && targetNode.layer !== node.layer) {
                const exports = registry.getExports(resolved);
                concreteCount += exports.length;
            }
        }

        if (concreteCount > 20) {
            suggestions.push({
                type: 'DECOUPLE',
                target: node.path,
                reason: `Component is coupled to ${concreteCount} symbols across layer boundaries.`,
                benefit: 'Reduces inter-layer friction and enables independent scaling.'
            });
        }
    }

    // 4. Heavy Hub Detection (Vitality aware)
    for (const node of this.engine.nodes.values()) {
        if ((node.vitality || 0) > 80 && node.resolvedImports.size > 15) {
            suggestions.push({
                type: 'EXTRACT',
                target: node.path,
                reason: `High Churn Hub detected. Extensive vitality (${node.vitality || 0} additions) and high outgoing coupling (${node.resolvedImports.size} imports).`,
                benefit: 'Stabilizes core logic by extracting high-frequency mutation points into leaf components.'
            });
        }
    }

    return suggestions;
  }
}
