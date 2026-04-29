/**
 * [LAYER: CORE]
 */

import * as fs from "fs/promises"
import { RefactorHealer } from "../task/tools/RefactorHealer.js"
import { IntegrityOptimizer, OptimizationOpportunity } from "./IntegrityOptimizer.js"
import { DecompositionPlan, ModuleDecomposer } from "./ModuleDecomposer.js"
import { RefactoringSuggestion, SpiderRefactorer } from "./SpiderRefactorer.js"
import { SpiderEngine } from "./spider/SpiderEngine.js"

export interface PulseReport {
	timestamp: string
	buildHealth: number
	violations: number
	recommendations: {
		refactors: RefactoringSuggestion[]
		optimizations: OptimizationOpportunity[]
		decompositionRequired?: DecompositionPlan[]
		healingShelf?: string[]
	}
}

/**
 * StabilityPulse: The architectural heartbeat of the project.
 * Provides a high-fidelity report by aggregating
 * all structural analysis engines into a single actionable dashboard.
 */
export class StabilityPulse {
	constructor(private cwd: string) {}

	public async generatePulse(engine: SpiderEngine): Promise<PulseReport> {
		const refactorer = SpiderRefactorer
		const optimizer = new IntegrityOptimizer()
		const decomposer = new ModuleDecomposer()

		const entropy = engine.computeEntropy()
		const violations = engine.getViolations()

		const refactors = refactorer.getRefactoringSuggestions(engine)
		const optimizations = optimizer.findOptimizations(engine)

		// Strategic Decomposition: Focus on top 3 "Fat" or "Complex" nodes
		const fatNodes = Array.from(engine.nodes.values())
			.sort((a, b) => b.astComplexity - a.astComplexity)
			.slice(0, 3)

		const decompositions: DecompositionPlan[] = []
		for (const node of fatNodes) {
			try {
				const content = await fs.readFile(node.path, "utf-8")
				decompositions.push(decomposer.analyze(node.path, content))
			} catch (_e) {
				// Skip if file unreadable
			}
		}

		const healer = new RefactorHealer(this.cwd)
		const healingShelf = violations.slice(0, 5).map((v) => healer.generateHealingRecipe(v))

		return {
			timestamp: new Date().toISOString(),
			buildHealth: (1 - entropy.score) * 100,
			violations: violations.length,
			recommendations: {
				refactors,
				optimizations,
				decompositionRequired: decompositions,
				healingShelf,
			},
		}
	}
}
