import path from "node:path"
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
	type?: "STRUCTURAL" | "DEADWOOD" | "COHESION" | "CYCLE_BREAK"
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

		// 1. Structural Alignment (Layer Drift)
		for (const node of engine.nodes.values()) {
			const current = node.layer
			const recommended = this.calculateOptimalLayer(node, engine, configs)

			if (recommended && current !== recommended) {
				const projectedGain = this.calculateProjectedGain(node, recommended)
				opportunities.push({
					file: node.path,
					currentLayer: current,
					recommendedLayer: recommended,
					reason: `Layer Drift: ${path.basename(node.path)} is gravitating toward '${recommended}' based on its dependency profile.`,
					integrityGain: projectedGain,
					type: "STRUCTURAL",
				})
			}

			// 2. Deadwood Sensing (Unused Exports)
			// V300: ZOMBIE MODULE Detection
			if (node.exports.length > 0 && node.afferentCoupling === 0 && !node.path.endsWith("index.ts")) {
				opportunities.push({
					file: node.path,
					currentLayer: node.layer,
					recommendedLayer: "DELETED",
					reason: `ZOMBIE MODULE: ${path.basename(node.path)} has 0 project-wide dependents. Pruning this deadwood will reduce architectural noise.`,
					integrityGain: 10,
					type: "DEADWOOD",
				})
			}

			// 3. Semantic Fragmentation (SRP Violation)
			const cohesion = engine.metrics.calculateSemanticCohesion(node)
			if (cohesion < 0.3 && node.exports.length > 5) {
				opportunities.push({
					file: node.path,
					currentLayer: node.layer,
					recommendedLayer: "SPLIT",
					reason: `Semantic Fragmentation: ${path.basename(node.path)} contains multiple unrelated vocabularies (Cohesion: ${Math.round(cohesion * 100)}%). Decompose this into mission-focused modules.`,
					integrityGain: 8,
					type: "COHESION",
				})
			}

			// 4. Architectural Archetypes (Distance from Main Sequence)
			const distance = engine.metrics.calculateDistanceFromMainSequence(node)
			if (distance > 0.7) {
				const instability = engine.metrics.calculateInstability(node)
				const isPainful = instability < 0.3 // Stable but Concrete
				opportunities.push({
					file: node.path,
					currentLayer: node.layer,
					recommendedLayer: isPainful ? "INTERFACE" : "STABLE_MODULE",
					reason: `Architectural ${isPainful ? "Rigidity" : "Fragility"}: This module is in the 'Zone of ${isPainful ? "Pain" : "Uselessness"}' (Distance: ${distance.toFixed(2)}). ${isPainful ? "Extract an interface to allow for future flexibility." : "Stabilize or unify this module with its consumers."}`,
					integrityGain: 12,
					type: "STRUCTURAL",
				})
			}

			// 6. Debt Liquidation (Maintainability Index)
			const mi = engine.metrics.calculateMaintainabilityIndex(node)
			if (mi < 30) {
				opportunities.push({
					file: node.path,
					currentLayer: node.layer,
					recommendedLayer: "REFACTOR",
					reason: `Critical Technical Debt: ${path.basename(node.path)} has a Maintainability Index of ${mi}. Massive refactoring is required to prevent industrial stagnation.`,
					integrityGain: 20,
					type: "STRUCTURAL",
				})
			}

			// 7. Structural Bottlenecks (Fan-In * Fan-Out)
			const bottleneck = engine.metrics.calculateStructuralBottleneck(node)
			if (bottleneck > 5000) {
				opportunities.push({
					file: node.path,
					currentLayer: node.layer,
					recommendedLayer: "DECOUPLE",
					reason: `Structural Bottleneck: ${path.basename(node.path)} is a high-congestion node (Flow Score: ${Math.round(bottleneck)}). Decouple its interfaces to reduce system fragility.`,
					integrityGain: 15,
					type: "STRUCTURAL",
				})
			}

			// 8. Type Hardening (Primitive Obsession)
			const obsession = engine.metrics.calculatePrimitiveObsession(node)
			if (obsession > 0.5) {
				opportunities.push({
					file: node.path,
					currentLayer: node.layer,
					recommendedLayer: "TYPE_DOMAIN",
					reason: `Primitive Obsession: ${path.basename(node.path)} relies heavily on generic types. Implement domain-specific types to harden the type substrate.`,
					integrityGain: 5,
					type: "STRUCTURAL",
				})
			}
		}

		// 5. Cycle Breaking
		const cycles = engine.detectCycles()
		for (const cycle of cycles) {
			const weakLink = this.identifyCycleWeakLink(cycle, engine)
			if (weakLink) {
				opportunities.push({
					file: weakLink.path,
					currentLayer: weakLink.layer,
					recommendedLayer: "SHARED_CORE",
					reason: `Cycle Breaking: Resolving loop (${cycle.map((p) => path.basename(p)).join(" -> ")}). Extract common logic from ${path.basename(weakLink.path)} to a shared package.`,
					integrityGain: 15,
					type: "CYCLE_BREAK",
				})
			}
		}

		return opportunities.sort((a, b) => b.integrityGain - a.integrityGain).slice(0, 15) // V300: Increased elite recommendation cap to 15.
	}

	private identifyCycleWeakLink(cycle: string[], engine: SpiderEngine): SpiderNode | null {
		// The weak link is usually the node with the highest afferent coupling outside the cycle
		let bestNode: SpiderNode | null = null
		let maxCoupling = -1

		for (const path of cycle) {
			const node = engine.nodes.get(path)
			if (node && (node.afferentCoupling || 0) > maxCoupling) {
				maxCoupling = node.afferentCoupling
				bestNode = node
			}
		}
		return bestNode
	}

	public calculateOptimalLayer(
		node: SpiderNode,
		_engine: SpiderEngine,
		configs?: { plumbing: LayerConfig; domain: LayerConfig; core: LayerConfig },
	): Layer | null {
		if (!_engine || !_engine.nodes) return node.layer || "plumbing"

		// V310: Archetypal Immunity
		// UI components (TSX/JSX) are archetypally bound to the UI layer.
		// They often import heavily from Core/Domain but must remain in the UI substrate.
		if (node.path.endsWith(".tsx") || node.path.endsWith(".jsx")) {
			return "ui"
		}

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

		for (const [layer, count] of Object.entries(layerCounts)) {
			const weight = weights[layer] || 1.0
			const weightedCount = count * weight
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

		// V310: Hysteresis Sensing
		// If a file is already correctly placed according to its layer path,
		// we require significantly higher gravity (1.5x) to justify a MOVE.
		const totalImports = (node.imports || []).length
		const threshold = matchesCurrentLayerPath ? 1.5 : 1.1

		if (maxWeightedCount > totalImports * threshold) return bestLayer

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
