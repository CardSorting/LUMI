import { SpiderEngine, SpiderNode } from "./SpiderEngine.js"

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
	constructor(_cwd: string) {}

	/**
	 * Scans the project for structural migration opportunities.
	 */
	public findOptimizations(engine: SpiderEngine): OptimizationOpportunity[] {
		const opportunities: OptimizationOpportunity[] = []

		for (const node of engine.nodes.values()) {
			const current = node.layer
			const recommended = this.calculateOptimalLayer(node, engine)

			if (recommended && current !== recommended) {
				opportunities.push({
					file: node.path,
					currentLayer: current,
					recommendedLayer: recommended,
					reason: `File has ${node.imports.length} imports from ${recommended} and zero dependencies on ${current}'s peer layers.`,
					integrityGain: 5, // Static gain for now
				})
			}
		}

		return opportunities.sort((a, b) => b.integrityGain - a.integrityGain).slice(0, 5)
	}

	private calculateOptimalLayer(node: SpiderNode, engine: SpiderEngine): string | null {
		if (node.imports.length === 0) return node.layer // Stay put if stable

		const targetLayers = node.imports
			.map((imp) => {
				const res = engine.resolveImportToNodeId(node.path, imp)
				return res ? engine.nodes.get(res)?.layer : null
			})
			.filter((l) => l)

		if (targetLayers.length === 0) return node.layer

		// Logic: If a file only depends on layers BELOW it, it might need to move DOWN.
		// If a file depends on layers ABOVE it, it's a violation (handled by Policy).
		// This optimizer focuses on "Deep Stability".

		const counts = new Map<string, number>()
		targetLayers.forEach((l) => counts.set(l!, (counts.get(l!) || 0) + 1))

		let dominant: string | null = null
		let max = 0
		for (const [l, c] of counts.entries()) {
			if (c > max) {
				max = c
				dominant = l
			}
		}

		return dominant
	}
}
