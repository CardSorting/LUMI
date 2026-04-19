import * as path from 'node:path';
import type { SpiderNode, SpiderEntropyReport, SpiderViolation } from '../SpiderEngine.js';

/**
 * MetricsEngine: Handles entropy scoring and structural violation detection.
 */
export class MetricsEngine {
  public computeEntropy(nodes: Map<string, SpiderNode>): SpiderEntropyReport {
    const totalNodes = nodes.size;
    if (totalNodes === 0) {
      return {
        score: 0,
        components: { depthScore: 0, namingScore: 0, orphanScore: 0, couplingScore: 0 },
      };
    }

    const avgDepth =
      Array.from(nodes.values()).reduce((acc, n) => acc + n.depth, 0) / totalNodes;
    const depthScore = Math.min(avgDepth / 4, 1.0);

    const namingViolations = Array.from(nodes.values()).filter((n) => {
      const base = path.basename(n.path).split('.')[0] || '';
      return !/^[a-z0-9-]+$/.test(base);
    }).length;
    const namingScore = namingViolations / totalNodes;

    const orphans = Array.from(nodes.values()).filter((n) => n.orphaned).length;
    const orphanScore = orphans / totalNodes;

    // Deep Circular Detection (Tarjan's SCC)
    const cycles = this.findCycles(nodes);
    const cycleScore = Math.min(cycles.length / 5, 1.0); // Penalty for architectural debt

    let crossLayerEdges = 0;
    let totalEdges = 0;
    for (const node of nodes.values()) {
      for (const resolved of node.resolvedImports) {
        totalEdges++;
        const targetNode = nodes.get(resolved);
        const targetLayer = targetNode?.layer || null;
        if (targetLayer && targetLayer !== node.layer && targetLayer !== 'plumbing') {
          crossLayerEdges++;
        }
      }
    }
    const couplingScore = totalEdges > 0 ? crossLayerEdges / totalEdges : 0;

    const score = depthScore * 0.2 + namingScore * 0.1 + orphanScore * 0.2 + couplingScore * 0.3 + cycleScore * 0.2;

    return { score, components: { depthScore, namingScore, orphanScore, couplingScore } };
  }

  /**
   * Deep Cycle Detection: Implementation of Tarjan's SCC to find all dependency loops.
   */
  private findCycles(nodes: Map<string, SpiderNode>): string[][] {
      const indexMap = new Map<string, number>();
      const lowlinkMap = new Map<string, number>();
      const stack: string[] = [];
      const onStack = new Set<string>();
      const result: string[][] = [];
      let index = 0;

      const visit = (u: string) => {
          indexMap.set(u, index);
          lowlinkMap.set(u, index);
          index++;
          stack.push(u);
          onStack.add(u);

          const node = nodes.get(u);
          if (node) {
              for (const v of node.resolvedImports) {
                  if (!indexMap.has(v)) {
                      visit(v);
                      lowlinkMap.set(u, Math.min(lowlinkMap.get(u)!, lowlinkMap.get(v)!));
                  } else if (onStack.has(v)) {
                      lowlinkMap.set(u, Math.min(lowlinkMap.get(u)!, indexMap.get(v)!));
                  }
              }
          }

          if (lowlinkMap.get(u) === indexMap.get(u)) {
              const component: string[] = [];
              let w: string;
              do {
                  w = stack.pop()!;
                  onStack.delete(w);
                  component.push(w);
              } while (u !== w);
              if (component.length > 1) {
                  result.push(component);
              }
          }
      };

      for (const id of nodes.keys()) {
          if (!indexMap.has(id)) {
              visit(id);
          }
      }
      return result;
  }

  public getViolations(nodes: Map<string, SpiderNode>): SpiderViolation[] {
    const violations: SpiderViolation[] = [];
    for (const node of nodes.values()) {
      if (node.depth > 4) {
        violations.push({
          id: 'SPI-001',
          severity: 'ERROR',
          message: `Path depth (${node.depth}) exceeds limit (4).`,
          path: node.id,
        });
      }
      const base = path.basename(node.path).split('.')[0] || '';
      if (!/^[a-z0-9-]+$/.test(base)) {
        violations.push({
          id: 'SPI-002',
          severity: 'WARN',
          message: `File name '${path.basename(node.path)}' violates kebab-case.`,
          path: node.id,
        });
      }
      if (node.orphaned) {
        violations.push({
          id: 'SPI-003',
          severity: 'WARN',
          message: 'Node is orphaned (unreachable from roots).',
          path: node.id,
        });
      }
    }

    const cycles = this.findCycles(nodes);
    for (const cycle of cycles) {
        violations.push({
            id: 'SPI-004',
            severity: 'ERROR',
            message: `Deep circular dependency detected: ${cycle.join(' -> ')} -> ${cycle[0]}`,
            path: cycle[0],
            cycle: cycle
        });
    }

    return violations;
  }
}
