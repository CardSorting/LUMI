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

	public calculateOptimalLayer(node: SpiderNode, _engine: SpiderEngine): string | null {
		// Fingerprint-based recommendation
		// 1. PLUMBING: Must be Simple & Stateless
		if (node.astComplexity < 500 && node.logicDensity < 0.05) {
			return "plumbing"
		}

		// 2. INFRASTRUCTURE: High I/O Entropy
		if (node.ioEntropy > 0.2) {
			return "infrastructure"
		}

		// 3. DOMAIN: Pure logic, no I/O
		if (node.ioEntropy === 0 && node.logicDensity > 0.15) {
			return "domain"
		}

		// 4. CORE: Orchestrator, Zero I/O, Medium Logic
		if (node.ioEntropy === 0 && node.logicDensity >= 0.05 && node.logicDensity <= 0.15) {
			return "core"
		}

		return node.layer // Default to current if no strong fingerprint match
	}
}
