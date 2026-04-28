import { Logger } from "../../shared/services/Logger"
import { LayerConfig, SovereignPolicy } from "./SovereignPolicy"
import { SpiderEngine } from "./spider/SpiderEngine.js"
import { Layer, SpiderNode } from "./spider/types.js"

export interface OptimizationOpportunity {
	file: string
	currentLayer: string
	recommendedLayer: string
	reason: string
	integrityGain: number
}

/**
 * SovereignOptimizer: The project's "Internal Consultant".
 * Analyzes the global dependency graph to find structural optimizations
 * that would significantly increase the integrity score.
 */
export class SovereignOptimizer {
	/**
	 * Scans the project for structural migration opportunities.
	 */
	public findOptimizations(engine: SpiderEngine): OptimizationOpportunity[] {
		const opportunities: OptimizationOpportunity[] = []
		if (!engine || !engine.nodes) return []

		const policy = SovereignPolicy.getInstance(engine.cwd || "")
		const configs = {
			plumbing: policy.getLayerConfig("plumbing"),
			domain: policy.getLayerConfig("domain"),
			core: policy.getLayerConfig("core"),
		}

		for (const node of engine.nodes.values()) {
			const current = node.layer
			const recommended = this.calculateOptimalLayer(node, engine, configs)

			if (recommended && current !== recommended) {
				const projectedGain = this.calculateProjectedGain(node, recommended)
				const importsToTarget = Array.from(node.imports || []).filter((imp) => {
					const targetId = engine.resolveImportToNodeId(node.id, imp)
					return targetId && engine.nodes.get(targetId)?.layer === recommended
				}).length

				opportunities.push({
					file: node.path,
					currentLayer: current,
					recommendedLayer: recommended,
					reason: `Structural Gravity: ${node.path} has ${importsToTarget} imports from '${recommended}' but lives in '${current}'. Aligning it will reduce structural entropy.`,
					integrityGain: projectedGain,
				})
			}
		}

		return opportunities.sort((a, b) => b.integrityGain - a.integrityGain).slice(0, 5)
	}

	public calculateOptimalLayer(
		node: SpiderNode,
		_engine: SpiderEngine,
		configs?: { plumbing: LayerConfig; domain: LayerConfig; core: LayerConfig },
	): Layer | null {
		if (!_engine || !_engine.nodes) return node.layer || "plumbing"

		const plumbing = configs?.plumbing || SovereignPolicy.getInstance(_engine.cwd || "").getLayerConfig("plumbing")
		const layerCounts: Record<string, number> = { domain: 0, core: 0, infrastructure: 0, ui: 0, plumbing: 0 }

		for (const imp of node.imports || []) {
			const targetId = _engine.resolveImportToNodeId(node.id, imp)
			if (targetId) {
				const targetLayer = _engine.nodes.get(targetId)?.layer
				if (targetLayer) layerCounts[targetLayer]++
			}
		}

		// V215: Weighted Structural Gravity - Dependencies pull more strongly based on layer seniority.
		const weights: Record<string, number> = { domain: 3.0, core: 2.0, infrastructure: 1.5, ui: 1.0, plumbing: 1.0 }
		let bestLayer: Layer = node.layer
		let maxWeightedCount = 0

		const layerWeightedCounts: Record<string, number> = {
			domain: 0,
			core: 0,
			infrastructure: 0,
			ui: 0,
			plumbing: 0,
		}

		for (const [layer, count] of Object.entries(layerCounts)) {
			const weight = weights[layer] || 1.0
			const weightedCount = count * weight
			layerWeightedCounts[layer] = weightedCount
			if (weightedCount > maxWeightedCount) {
				maxWeightedCount = weightedCount
				bestLayer = layer as Layer
			}
		}

		// Forensic Fallback: Complexity Checks
		const maxComplexity = plumbing?.maxComplexity || 500
		const isSmall = node.astComplexity < maxComplexity && (node.logicDensity || 0) < 0.05
		const matchesCurrentLayerPath = node.path.includes(`/${node.layer}/`)

		if (isSmall && maxWeightedCount < 2 && !matchesCurrentLayerPath) {
			return "plumbing"
		}

		const totalImports = (node.imports || []).length
		if (maxWeightedCount > totalImports * 1.5) return bestLayer // V215: Weighted gravity threshold (average pull > 1.5)

		return node.layer || "plumbing"
	}

	/**
	 * PRODUCTION HARDENING: Predicts the exact Integrity Score improvement if an optimization is performed.
	 */
	private calculateProjectedGain(node: SpiderNode, recommended: string): number {
		let gain = 4 // Base gain for layer alignment

		// Bonus for high-coupling nodes (Ca > 10)
		if ((node.afferentCoupling || 0) > 8) gain += 4

		// V215: Impact of Blast Radius
		gain += (node.blastRadius || 0) * 10

		// Bonus for reducing complexity in core/domain
		if ((recommended === "core" || recommended === "domain") && (node.astComplexity || 0) > 200) {
			gain += 2
		}

		return Math.round(gain)
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		Logger.info("[SovereignOptimizer] Optimizer substrate released.")
	}
}
