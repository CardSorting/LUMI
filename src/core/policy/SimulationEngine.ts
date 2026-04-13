import * as path from "path"
import { PathogenStore } from "../integrity/PathogenStore"
import { SpiderEngine } from "./SpiderEngine.js"

export interface SimulationResult {
	safe: boolean
	predictedScore: number
	scoreDrop: number
	violations: string[]
	message: string
}

/**
 * SimulationEngine: The Pre-flight Prophet of JoyZoning.
 * Clones the structural state and predicts the impact of architectural changes
 * BEFORE they are committed to disk.
 */
export class SimulationEngine {
	constructor(private cwd: string) {}

	/**
	 * Simulates a file move/rename and predicts the integrity outcome.
	 */
	public async simulateMove(
		oldPath: string,
		newPath: string,
		currentEngine: SpiderEngine,
		pathogens: PathogenStore,
	): Promise<SimulationResult> {
		// Immune Check
		if (pathogens.isPathogenic(oldPath)) {
			return {
				safe: false,
				predictedScore: 0,
				scoreDrop: 100,
				violations: ["Pathogen detected"],
				message:
					"PATHOGEN DETECTED: This move has failed in the past. Re-routing attempt to prevent architectural regression.",
			}
		}

		const simEngine = this.cloneEngine(currentEngine)

		// 1. Resolve logical paths
		const normalizedOld = this.normalize(oldPath)
		const normalizedNew = this.normalize(newPath)

		// 2. Perform virtual move
		const node = simEngine.nodes.get(normalizedOld)
		if (!node) {
			return { safe: true, predictedScore: 100, scoreDrop: 0, violations: [], message: "Source node not found in graph." }
		}

		// Virtual re-target
		simEngine.nodes.delete(normalizedOld)
		simEngine.nodes.set(normalizedNew, {
			...node,
			id: normalizedNew,
			path: normalizedNew,
			depth: normalizedNew.split("/").length - 1,
		})

		// 3. Re-compute coupling and entropy
		simEngine.computeCouplingMetrics()
		// @ts-expect-error
		simEngine.computeReachability()

		const currentReport = currentEngine.computeEntropy()
		const simReport = simEngine.computeEntropy()

		const scoreDrop = (currentReport.score - simReport.score) * 100
		const violations = simEngine.getViolations().map((v) => v.message)

		const isSafe = scoreDrop < 10 && violations.length === 0

		return {
			safe: isSafe,
			predictedScore: (1 - simReport.score) * 100,
			scoreDrop,
			violations,
			message: isSafe
				? "Simulation predicts stable transition."
				: `Simulation Warning: Move predicts a ${(scoreDrop).toFixed(1)}% drop in structural integrity.`,
		}
	}

	/**
	 * Simulates a file edit/creation.
	 */
	public async simulateEdit(filePath: string, newImports: string[], currentEngine: SpiderEngine): Promise<SimulationResult> {
		const simEngine = this.cloneEngine(currentEngine)
		const normalizedPath = this.normalize(filePath)

		const node = simEngine.nodes.get(normalizedPath)
		if (node) {
			node.imports = newImports
		} else {
			// New file simulation
			simEngine.nodes.set(normalizedPath, {
				id: normalizedPath,
				path: normalizedPath,
				layer: "infrastructure", // Default for simulation estimation
				imports: newImports,
				depth: normalizedPath.split("/").length - 1,
				orphaned: false,
				afferentCoupling: 0,
				dependents: [],
				logicDensity: 0,
				ioEntropy: 0,
				astComplexity: 0,
				hash: "",
			})
		}

		simEngine.computeCouplingMetrics()
		// @ts-expect-error
		simEngine.computeReachability()

		const currentReport = currentEngine.computeEntropy()
		const simReport = simEngine.computeEntropy()

		const scoreDrop = (currentReport.score - simReport.score) * 100
		const violations = simEngine.getViolations().map((v) => v.message)

		return {
			safe: scoreDrop < 5,
			predictedScore: (1 - simReport.score) * 100,
			scoreDrop,
			violations,
			message: scoreDrop > 5 ? "Predictive warning: Edit increases structural entropy." : "Safe edit predicted.",
		}
	}

	private cloneEngine(source: SpiderEngine): SpiderEngine {
		return source.clone()
	}

	private normalize(p: string): string {
		const abs = path.resolve(this.cwd, p)
		const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
		return rel
	}
}
