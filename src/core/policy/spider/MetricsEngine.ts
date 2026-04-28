import * as path from "path"
import * as ts from "typescript"
import { Logger } from "../../../shared/services/Logger.js"
import { PathResolver } from "./PathResolver.js"
import { SpiderEntropyReport, SpiderNode } from "./types.js"

export class MetricsEngine {
	constructor(
		_cwd: string,
		private resolver: PathResolver,
	) {}

	public computeCouplingMetrics(nodes: Map<string, SpiderNode>) {
		const couplingMap = new Map<string, number>()
		for (const id of nodes.keys()) couplingMap.set(id, 0)

		for (const node of nodes.values()) {
			node.dependents = []
			// V215: Comprehensive Coupling (Imports + Resolved Re-exports)
			const imports = node.imports || []
			const reExports = node.reExports || []
			const connections = new Set([...imports, ...reExports])

			for (const imp of connections) {
				// V215: Fast-path for already resolved re-exports (which are IDs)
				const resolved: string | null = nodes.has(imp) ? imp : this.resolver.resolveImportToNodeId(node.path, imp, nodes)

				if (resolved && couplingMap.has(resolved)) {
					couplingMap.set(resolved, (couplingMap.get(resolved) || 0) + 1)
					const targetNode = nodes.get(resolved)
					if (targetNode) {
						if (!targetNode.dependents) targetNode.dependents = []
						if (!targetNode.dependents.includes(node.id)) {
							targetNode.dependents.push(node.id)
						}
					}
				}
			}
		}

		for (const [id, count] of couplingMap.entries()) {
			const node = nodes.get(id)
			if (node) {
				node.afferentCoupling = count
				if (count > 5 && (node.imports || []).length > 5) {
					Logger.info(`[MetricsEngine] Efferent Cluster detected in legacy module: ${path.basename(id)}`)
				}
			}
		}
	}

	public computeReachability(nodes: Map<string, SpiderNode>): boolean {
		const roots = Array.from(nodes.values()).filter((n) => {
			const p = n.path
			return (
				n.layer === "ui" ||
				n.layer === "core" ||
				p.includes("main.") ||
				p.includes("index.") ||
				p === "src/extension.ts" ||
				p === "src/common.ts" ||
				p.startsWith("src/standalone/") ||
				p.startsWith("src/scripts/") ||
				p.startsWith("src/common/") ||
				p.includes("/__tests__/") ||
				/\.(test|spec)\.tsx?$/.test(p) ||
				// PRODUCTION HARDENING: Explicitly recognize build/config files as roots to prevent orphan false-positives
				p.endsWith(".config.js") ||
				p.endsWith(".config.ts") ||
				p.endsWith(".config.mjs") ||
				p === "package.json" ||
				p === "tsconfig.json" ||
				p === "biome.json" ||
				p === "biome.jsonc"
			)
		})

		const reachable = new Set<string>()
		const queue = roots.map((r) => r.id)
		for (const id of queue) reachable.add(id)

		let head = 0
		while (head < queue.length) {
			const currentId = queue[head++]
			if (!currentId) continue
			const node = nodes.get(currentId)
			if (node) {
				// V215: Dual-Path Resolution (Imports + Re-exports)
				// Ensures modules connected via wildcard re-exports (export * from '...') are recognized as reachable.
				const connections = [...(node.imports || []), ...(node.reExports || [])]
				for (const imp of connections) {
					// V215: If 'imp' is already a node ID (common for reExports after rebuild), skip resolution.
					const resolved: string | null = nodes.has(imp)
						? imp
						: this.resolver.resolveImportToNodeId(node.path, imp, nodes)

					if (resolved && nodes.has(resolved) && !reachable.has(resolved)) {
						reachable.add(resolved)
						queue.push(resolved)
					}
				}
			}
		}

		let changed = false
		for (const node of nodes.values()) {
			const isOrphaned = !reachable.has(node.id)
			if (node.orphaned !== isOrphaned) {
				node.orphaned = isOrphaned
				changed = true
			}
		}
		return changed
	}

	public detectCycles(nodes: Map<string, SpiderNode>): string[][] {
		const cycles: string[][] = []
		const visited = new Set<string>()
		const visiting = new Set<string>()
		const stack: string[] = []
		const nodeIds = new Set(nodes.keys())
		const cycleHashes = new Set<string>()

		const dfs = (nodeId: string) => {
			visited.add(nodeId)
			visiting.add(nodeId)
			stack.push(nodeId)

			const node = nodes.get(nodeId)
			if (node) {
				const imports = node.imports || []
				for (const imp of imports) {
					const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, nodeIds)
					if (!targetId || !nodes.has(targetId)) continue

					if (visiting.has(targetId)) {
						const cycleStart = stack.indexOf(targetId)
						const cycleNodes = stack.slice(cycleStart)

						// V215: Canonical Cycle Hashing (Deduplication)
						// Sort nodes alphabetically to create a deterministic signature for the cycle
						const hash = [...cycleNodes].sort().join("|")
						if (!cycleHashes.has(hash)) {
							cycleHashes.add(hash)
							cycles.push(cycleNodes)
						}
					} else if (!visited.has(targetId)) {
						dfs(targetId)
					}
				}
			}
			visiting.delete(nodeId)
			stack.pop()
		}

		for (const nodeId of nodes.keys()) {
			if (!visited.has(nodeId)) dfs(nodeId)
		}
		return cycles
	}

	public computeEntropy(nodes: Map<string, SpiderNode>): SpiderEntropyReport {
		const totalNodes = nodes.size
		if (totalNodes === 0)
			return { score: 0, components: { depthScore: 0, namingScore: 0, orphanScore: 0, couplingScore: 0, cycles: 0 } }

		const nodesArray = Array.from(nodes.values())
		const avgDepth = nodesArray.reduce((acc, n) => acc + n.depth, 0) / totalNodes
		const depthScore = Math.min(avgDepth / 4, 1.0)

		const avgNaming = nodesArray.reduce((acc, n) => acc + (n.namingScore || 0), 0) / totalNodes
		const namingScore = 1.0 - avgNaming // Invert so higher score = more naming violations

		const orphans = nodesArray.filter((n) => n.orphaned).length
		const orphanScore = orphans / totalNodes

		let crossLayerEdges = 0
		let totalEdges = 0
		for (const node of nodesArray) {
			const imports = node.imports || []
			for (const imp of imports) {
				totalEdges++
				const targetId = this.resolver.resolveImportToNodeId(node.id, imp, new Set(nodes.keys()))
				const targetLayer = targetId ? this.resolver.resolveLayer(targetId) : null

				if (targetLayer && targetLayer !== node.layer && targetLayer !== "plumbing") {
					crossLayerEdges++
				}
			}
		}
		const couplingScore = totalEdges > 0 ? Math.min(1.0, crossLayerEdges / totalEdges) : 0
		const cycles = this.detectCycles(nodes)
		const cyclePenalty = cycles.length > 0 ? Math.min(0.3, cycles.length * 0.05) : 0

		// V160: Calibrated Industrial Entropy Formula
		const rawScore = depthScore * 0.2 + namingScore * 0.2 + orphanScore * 0.2 + couplingScore * 0.4
		const score = Math.max(0, Math.min(1.0, rawScore + cyclePenalty))

		return { score, components: { depthScore, namingScore, orphanScore, couplingScore, cycles: cycles.length } }
	}

	/**
	 * V200: Cognitive Entropy (Semantic Analysis).
	 * Calculates cyclomatic and nesting complexity using the TypeScript AST.
	 */
	public calculateCognitiveComplexity(sourceFile: ts.SourceFile): number {
		let complexity = 0
		let nesting = 0

		const visit = (node: ts.Node) => {
			// Cyclomatic complexity markers
			if (
				ts.isIfStatement(node) ||
				ts.isSwitchStatement(node) ||
				ts.isForStatement(node) ||
				ts.isForInStatement(node) ||
				ts.isForOfStatement(node) ||
				ts.isWhileStatement(node) ||
				ts.isDoStatement(node) ||
				ts.isCatchClause(node) ||
				ts.isConditionalExpression(node) ||
				(ts.isBinaryExpression(node) &&
					(node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
						node.operatorToken.kind === ts.SyntaxKind.BarBarToken))
			) {
				complexity++
				complexity += nesting * 0.5 // Weighted by depth
			}

			// Nesting depth
			if (ts.isBlock(node) || ts.isFunctionLike(node)) {
				nesting++
				ts.forEachChild(node, visit)
				nesting--
			} else {
				ts.forEachChild(node, visit)
			}
		}

		ts.forEachChild(sourceFile, visit)
		// V215: Calibrated normalization (Logarithmic scale)
		// Previous linear 1/40 was too sensitive for large modules.
		const result = Math.min(Math.log10(1 + complexity / 20), 1.0)

		return result
	}
}
