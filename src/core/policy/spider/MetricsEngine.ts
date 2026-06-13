import * as path from "path"
import * as ts from "typescript"
import { Logger } from "../../../shared/services/Logger"
import { PathResolver } from "./PathResolver"
import { SpiderEntropyReport, SpiderNode, SpiderSnapshot } from "./types"

export class MetricsEngine {
	constructor(
		_cwd: string,
		private resolver: PathResolver,
	) {}

	/**
	 * V215: Cognitive Architectural Resonance.
	 * Calculates multivariate statistics (Mean/StdDev) across the entire workspace.
	 */
	public getProjectStatistics(nodes: Map<string, SpiderNode>): {
		complexity: { mean: number; stdDev: number }
		coupling: { mean: number; stdDev: number }
		size: { mean: number; stdDev: number }
		giniCoefficient: number
	} {
		const values = Array.from(nodes.values())
		const totalFiles = values.length
		if (totalFiles === 0) {
			return {
				complexity: { mean: 0, stdDev: 0 },
				coupling: { mean: 0, stdDev: 0 },
				size: { mean: 0, stdDev: 0 },
				giniCoefficient: 0,
			}
		}

		const getStats = (nums: number[]) => {
			const mean = nums.reduce((a, b) => a + b, 0) / totalFiles
			const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / totalFiles
			return { mean, stdDev: Math.sqrt(variance) }
		}

		// Approximate line counts
		const estimatedLines = values.map((n) => n.astComplexity / 10 + n.exports.length * 5)

		return {
			complexity: getStats(values.map((n) => n.astComplexity)),
			coupling: getStats(values.map((n) => n.afferentCoupling)),
			size: getStats(estimatedLines),
			giniCoefficient: this.calculateGiniCoefficient(values.map((n) => n.afferentCoupling)),
		}
	}

	/**
	 * V215: Hubbiness Analyzer (Gini Coefficient).
	 * Measures the inequality of dependency distribution.
	 * A high Gini coefficient (> 0.7) indicates a "Hub and Spoke" (Monolithic) architecture.
	 */
	private calculateGiniCoefficient(nums: number[]): number {
		if (nums.length === 0) return 0
		const sorted = [...nums].sort((a, b) => a - b)
		const n = sorted.length
		let sumOfDifferences = 0
		for (let i = 0; i < n; i++) {
			sumOfDifferences += (2 * i - n - 1) * sorted[i]
		}
		return sumOfDifferences / (n * n * (sorted.reduce((a, b) => a + b, 0) / n))
	}

	public calculateZScore(value: number, stats: { mean: number; stdDev: number }): number {
		if (stats.stdDev === 0) return 0
		return (value - stats.mean) / stats.stdDev
	}

	/**
	 * V215: Dynamic Metabolic Calibration.
	 * Calculates average metrics across the entire workspace to establish
	 * project-specific thresholds.
	 */
	/**
	 * V215: Metabolic Decay Velocity.
	 * Measures the 'Structural Half-Life' of modules.
	 * Identifies modules where complexity is rising but integrity is falling.
	 */
	public trackStructuralHalfLife(node: SpiderNode, snapshots: SpiderSnapshot[]): number {
		if (snapshots.length < 5) return 1.0

		const history = snapshots.map((s) => s.nodes.find((n) => n.id === node.id)).filter(Boolean) as SpiderNode[]
		if (history.length < 2) return 1.0

		const first = history[0]
		const last = history[history.length - 1]

		const complexityDelta = (last.astComplexity - first.astComplexity) / Math.max(1, first.astComplexity)
		const couplingDelta = (last.afferentCoupling - first.afferentCoupling) / Math.max(1, first.afferentCoupling)

		// Decay is positive if complexity/coupling are rising faster than 10% per session
		return (complexityDelta + couplingDelta) / 2
	}

	/**
	 * V215: Refactoring Fatigue Sensing.
	 * Identifies 'Stagnant Hotspots'—high churn with zero structural improvement.
	 */
	public detectRefactoringFatigue(node: SpiderNode, pressure: number, snapshots: SpiderSnapshot[]): boolean {
		if (pressure < 0.7 || snapshots.length < 5) return false

		const history = snapshots.map((s) => s.nodes.find((n) => n.id === node.id)).filter(Boolean) as SpiderNode[]
		if (history.length < 5) return false

		// Check if complexity has stayed constant despite high pressure
		const complexities = history.map((n) => n.astComplexity)
		const variance = complexities.reduce((a, b) => a + (b - complexities.reduce((x, y) => x + y, 0) / history.length) ** 2, 0)

		return variance < 10 // Zero structural evolution despite high pressure
	}

	public getProjectBaselines(nodes: Map<string, SpiderNode>): {
		avgComplexity: number
		avgCoupling: number
		avgFileLineCount: number
	} {
		const values = Array.from(nodes.values())
		if (values.length === 0) {
			return { avgComplexity: 0, avgCoupling: 0, avgFileLineCount: 0 }
		}

		const totalComplexity = values.reduce((acc, n) => acc + n.astComplexity, 0)
		const totalCoupling = values.reduce((acc, n) => acc + n.afferentCoupling, 0)
		const totalFiles = values.length

		// Approximate line counts (conservative estimate from exports/complexity ratio)
		const estimatedTotalLines = values.reduce((acc, n) => acc + (n.astComplexity / 10 + n.exports.length * 5), 0)

		return {
			avgComplexity: totalComplexity / totalFiles,
			avgCoupling: totalCoupling / totalFiles,
			avgFileLineCount: estimatedTotalLines / totalFiles,
		}
	}

	public calculateTemporalFragility(node: SpiderNode, growthVelocity: number, pressure: number): number {
		const densityWeight = node.logicDensity * 2.0
		const velocityWeight = Math.abs(growthVelocity) * 3.0
		const pressureWeight = pressure * 1.5

		const score = (densityWeight + velocityWeight + pressureWeight) / 6.5
		return Math.min(1.0, score)
	}

	/**
	 * V300: Industrial Architectural Metrics (Robert C. Martin).
	 */

	/**
	 * Instability (I) = Ce / (Ca + Ce)
	 * Ce: Efferent Coupling (Outgoing dependencies)
	 * Ca: Afferent Coupling (Incoming dependencies)
	 * I = 0: Completely stable (nothing depends on it changing)
	 * I = 1: Completely unstable (depends on everything)
	 */
	public calculateInstability(node: SpiderNode): number {
		const ca = node.afferentCoupling || 0
		const ce = (node.imports || []).length
		if (ca + ce === 0) return 0
		return ce / (ca + ce)
	}

	/**
	 * Abstractness (A) = Na / Nc
	 * Na: Number of abstract classes/interfaces
	 * Nc: Total number of classes
	 * For a single file, we treat it as 1.0 if it's an interface/type-only, and 0.0 otherwise.
	 */
	public calculateAbstractness(node: SpiderNode): number {
		return node.isInterface ? 1.0 : 0.0
	}

	/**
	 * Distance from Main Sequence (D) = |A + I - 1|
	 * Measures the balance between stability and abstractness.
	 * D = 0: Ideal (Balanced)
	 * D = 1: Zone of Pain (Stable but concrete) or Zone of Uselessness (Abstract but unstable)
	 */
	public calculateDistanceFromMainSequence(node: SpiderNode): number {
		const a = this.calculateAbstractness(node)
		const i = this.calculateInstability(node)
		return Math.abs(a + i - 1)
	}

	/**
	 * V400: Predictive Maintenance Metrics.
	 */

	/**
	 * Maintainability Index (MI)
	 * A logarithmic scale (0-100) indicating the long-term maintainability of a module.
	 * 100 = Perfect, < 20 = Critical Tech Debt.
	 */
	public calculateMaintainabilityIndex(node: SpiderNode): number {
		const sloc = Math.max(1, (node.astComplexity || 0) / 10)
		const cyc = (node.cognitiveComplexity || 0) * 20
		// Estimated Halstead Volume
		const volume = (node.astComplexity || 0) * Math.log2(Math.max(2, (node.exports || []).length + 5))

		const miRaw = 171 - 5.2 * Math.log(volume) - 0.23 * cyc - 16.2 * Math.log(sloc)
		const mi = Math.max(0, Math.min(100, (miRaw * 100) / 171))
		return Math.round(mi)
	}

	/**
	 * Structural Bottleneck (Fan-In * Fan-Out)^2
	 * Identifies nodes that are high-congestion points.
	 */
	public calculateStructuralBottleneck(node: SpiderNode): number {
		const fanIn = node.afferentCoupling || 0
		const fanOut = (node.imports || []).length
		return (fanIn * fanOut) ** 2
	}

	/**
	 * Primitive Obsession Score
	 * Ratio of any-types and primitive identifiers to total symbols.
	 */
	public calculatePrimitiveObsession(node: SpiderNode): number {
		const any = node.anyDensity || 0
		// Heuristic: If symbol density is high but complexity is also high, and anyDensity is > 0.1
		if (any > 0.2) return any * 1.5
		return any
	}

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
			const node = nodes.get(nodeId)
			// V270: Exclude interface-only nodes from runtime cycle detection.
			// Structural loops between interfaces are harmless and should not block progress.
			if (!node || node.isInterface) {
				visited.add(nodeId)
				return
			}

			visited.add(nodeId)
			visiting.add(nodeId)
			stack.push(nodeId)

			const imports = node.imports || []
			for (const imp of imports) {
				const targetId = this.resolver.resolveImportToNodeId(nodeId, imp, nodeIds)
				if (!targetId || !nodes.has(targetId)) continue

				if (visiting.has(targetId)) {
					const cycleStart = stack.indexOf(targetId)
					const cycleNodes = stack.slice(cycleStart)

					// V215: Canonical Cycle Hashing (Deduplication)
					const hash = [...cycleNodes].sort().join("|")
					if (!cycleHashes.has(hash)) {
						cycleHashes.add(hash)
						cycles.push(cycleNodes)
					}
				} else if (!visited.has(targetId)) {
					dfs(targetId)
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

	public computeEntropy(nodes: Map<string, SpiderNode>, history: number[] = []): SpiderEntropyReport {
		const totalNodes = nodes.size
		if (totalNodes === 0)
			return {
				score: 0,
				components: {
					depthScore: 0,
					namingScore: 0,
					orphanScore: 0,
					couplingScore: 0,
					cycles: 0,
					cognitiveScore: 0,
				},
				entropyVelocity: 0,
			}

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

		const cognitiveScore = nodesArray.reduce((acc, n) => acc + (n.cognitiveComplexity || 0), 0) / totalNodes

		// V215: Calibrated Industrial Entropy Formula
		// Factors: Depth (10%), Naming (15%), Orphans (15%), Coupling (40%), Cognitive (20%)
		const rawScore = depthScore * 0.1 + namingScore * 0.15 + orphanScore * 0.15 + couplingScore * 0.4 + cognitiveScore * 0.2
		const score = Math.max(0, Math.min(1.0, rawScore + cyclePenalty))

		// V215: Entropy Velocity Sensing
		// A positive velocity means entropy is GROWING.
		const lastScore = history.length > 0 ? history[history.length - 1] : score
		const entropyVelocity = score - lastScore

		return {
			score,
			components: { depthScore, namingScore, orphanScore, couplingScore, cycles: cycles.length, cognitiveScore },
			entropyVelocity,
		}
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

			// V215: Cognitive Depth Scaling
			// Deeply nested blocks (loops, ifs) contribute more to the overall weight.
			if (ts.isBlock(node) || ts.isFunctionLike(node)) {
				nesting++
				complexity += nesting * 0.2 // V215: Reward shallow structure
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

	/**
	 * V215: Implicit Cohesion Analysis.
	 * Identifies "Logical Twins"—files that are conceptually similar (logic/symbol density)
	 * but have no structural connection in the graph.
	 */
	public detectLogicalTwins(nodes: Map<string, SpiderNode>): string[][] {
		const twins: string[][] = []
		const nodesArray = Array.from(nodes.values()).filter((n) => n.astComplexity > 200)

		for (let i = 0; i < nodesArray.length; i++) {
			for (let j = i + 1; j < nodesArray.length; j++) {
				const a = nodesArray[i]
				const b = nodesArray[j]

				// Check for logical signature similarity
				const densityDiff = Math.abs(a.logicDensity - b.logicDensity)
				const symbolDiff = Math.abs(a.symbolDensity - b.symbolDensity)
				const complexityDiff = Math.abs(a.astComplexity - b.astComplexity) / Math.max(a.astComplexity, b.astComplexity)

				const isSimilar = densityDiff < 0.05 && symbolDiff < 0.1 && complexityDiff < 0.2
				const isDecoupled = !a.imports.includes(b.path) && !b.imports.includes(a.path)

				if (isSimilar && isDecoupled) {
					twins.push([a.path, b.path])
				}
			}
		}
		return twins
	}

	/**
	 * V215: Semantic Cohesion Analysis.
	 * Analyzes method/symbol names for vocabulary overlap.
	 * High fragmentation indicates a violation of the Single Responsibility Principle.
	 */
	public calculateSemanticCohesion(node: SpiderNode): number {
		if (node.exports.length < 2) return 1.0

		const words = node.exports.flatMap((e) => {
			// Split camelCase/PascalCase into words
			return e.split(/(?=[A-Z])|_/).map((w) => w.toLowerCase())
		})

		const wordCounts = new Map<string, number>()
		for (const w of words) {
			if (w.length < 3) continue
			wordCounts.set(w, (wordCounts.get(w) || 0) + 1)
		}

		// Calculate overlap: Ratio of recurring words to total unique words
		const recurring = Array.from(wordCounts.values()).filter((c) => c > 1).length
		const totalUnique = wordCounts.size
		if (totalUnique === 0) return 1.0

		return Math.min(recurring / (totalUnique * 0.5), 1.0)
	}

	/**
	 * V215: Hotspot Forecasting.
	 * Compares current AST complexity growth across snapshots.
	 * Flags files expanding > 20% as "Expanding Hotspots".
	 */
	public calculateGrowthVelocity(node: SpiderNode, lastSnapshot?: SpiderSnapshot): number {
		if (!lastSnapshot) return 0
		const oldNode = lastSnapshot.nodes.find((n) => n.id === node.id)
		if (!oldNode) return 0

		const complexityDelta = node.astComplexity - oldNode.astComplexity
		return complexityDelta / Math.max(oldNode.astComplexity, 1)
	}

	/**
	 * V215: Entangled Dependency Detection.
	 * Analyzes co-mutation patterns across historical snapshots.
	 * Identifies pairs of files that change together but share no structural link.
	 */
	public detectEntangledDependencies(snapshots: SpiderSnapshot[]): string[] {
		if (snapshots.length < 3) return []

		const changeMatrix = new Map<string, Set<number>>()
		for (let i = 1; i < snapshots.length; i++) {
			const current = snapshots[i]
			const previous = snapshots[i - 1]

			for (const node of current.nodes) {
				const prevNode = previous.nodes.find((n) => n.id === node.id)
				if (prevNode && node.hash !== prevNode.hash) {
					let changes = changeMatrix.get(node.id)
					if (!changes) {
						changes = new Set()
						changeMatrix.set(node.id, changes)
					}
					changes.add(i)
				}
			}
		}

		const entanglements: string[] = []
		const ids = Array.from(changeMatrix.keys())

		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const idA = ids[i]
				const idB = ids[j]

				const changesA = changeMatrix.get(idA)
				const changesB = changeMatrix.get(idB)

				if (!changesA || !changesB) continue

				// Calculate Jaccard similarity of change sets
				const intersection = new Set([...changesA].filter((x) => changesB.has(x)))
				const union = new Set([...changesA, ...changesB])
				const similarity = intersection.size / union.size

				if (similarity > 0.7 && intersection.size >= 2) {
					entanglements.push(
						`[SPI-108] GHOST COUPLING: ${path.basename(idA)} and ${path.basename(idB)} changed together in ${intersection.size} sessions. Hidden logical coupling detected.`,
					)
				}
			}
		}

		return entanglements
	}
}
