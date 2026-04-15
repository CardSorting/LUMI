import * as path from "path"
import { Logger } from "../../../shared/services/Logger.js"
import { PathResolver } from "./PathResolver.js"
import { SpiderEntropyReport, SpiderNode } from "./types.js"

export class MetricsEngine {
	constructor(
		private cwd: string,
		private resolver: PathResolver,
	) {}

	public computeCouplingMetrics(nodes: Map<string, SpiderNode>) {
		const couplingMap = new Map<string, number>()
		for (const id of nodes.keys()) couplingMap.set(id, 0)

		for (const node of nodes.values()) {
			node.dependents = []
			for (const imp of node.imports) {
				const resolved = this.resolver.resolveImportToNodeId(node.path, imp, new Set(nodes.keys()))
				if (resolved && couplingMap.has(resolved)) {
					couplingMap.set(resolved, (couplingMap.get(resolved) || 0) + 1)
					const targetNode = nodes.get(resolved)
					if (targetNode && !targetNode.dependents.includes(node.id)) {
						targetNode.dependents.push(node.id)
					}
				}
			}
		}

		for (const [id, count] of couplingMap.entries()) {
			const node = nodes.get(id)
			if (node) {
				node.afferentCoupling = count
				if (count > 5 && node.imports.length > 5) {
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
				/\.(test|spec)\.tsx?$/.test(p)
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
				for (const imp of node.imports) {
					const resolved = this.resolver.resolveImportToNodeId(node.path, imp, new Set(nodes.keys()))
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

		const dfs = (nodeId: string) => {
			visited.add(nodeId)
			visiting.add(nodeId)
			stack.push(nodeId)

			const node = nodes.get(nodeId)
			if (node) {
				for (const imp of node.imports) {
					const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, new Set(nodes.keys()))
					if (!targetId || !nodes.has(targetId)) continue

					if (visiting.has(targetId)) {
						const cycleStart = stack.indexOf(targetId)
						cycles.push(stack.slice(cycleStart))
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

		const avgDepth = Array.from(nodes.values()).reduce((acc, n) => acc + n.depth, 0) / totalNodes
		const depthScore = Math.min(avgDepth / 4, 1.0)
		const orphans = Array.from(nodes.values()).filter((n) => n.orphaned).length
		const orphanScore = orphans / totalNodes

		let crossLayerEdges = 0
		let totalEdges = 0
		for (const node of nodes.values()) {
			for (const imp of node.imports) {
				totalEdges++
				const targetLayer = this.resolver.resolveLayer(
					this.resolver.resolveImportToNodeId(node.id, imp, new Set(nodes.keys())) || "",
				)
				if (targetLayer && targetLayer !== node.layer && targetLayer !== "plumbing") {
					crossLayerEdges++
				}
			}
		}
		const couplingScore = totalEdges > 0 ? crossLayerEdges / totalEdges : 0
		const cycles = this.detectCycles(nodes)
		const cyclePenalty = cycles.length > 0 ? Math.min(0.2, cycles.length * 0.05) : 0

		const score = Math.max(0, depthScore * 0.3 + 0 * 0.2 + orphanScore * 0.2 + couplingScore * 0.3 - cyclePenalty)
		return { score, components: { depthScore, namingScore: 0, orphanScore, couplingScore, cycles: cycles.length } }
	}
}
