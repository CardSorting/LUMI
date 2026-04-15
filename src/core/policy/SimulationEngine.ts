import * as path from "path"
import { PathogenStore } from "../integrity/PathogenStore"
import { SpiderEngine } from "./spider/SpiderEngine.js"
import "@/utils/path"

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

		// Virtual re-target and migration (v15)
		simEngine.nodes.delete(normalizedOld)
		const migratedNode = {
			...node,
			id: normalizedNew,
			path: normalizedNew,
			depth: normalizedNew.split("/").length - 1,
		}
		simEngine.nodes.set(normalizedNew, migratedNode)

		// VIRTUAL RE-LINKING: Update all nodes that imported the old path
		for (const otherNode of simEngine.nodes.values()) {
			if (otherNode.imports.includes(normalizedOld)) {
				otherNode.imports = otherNode.imports.map((imp) => (imp === normalizedOld ? normalizedNew : imp))
			}
		}

		// 3. Re-compute coupling and entropy
		simEngine.computeCouplingMetrics()
		simEngine.computeReachability()

		const currentReport = currentEngine.computeEntropy()
		const simReport = simEngine.computeEntropy()

		const scoreDrop = (currentReport.score - simReport.score) * 100
		const violations = simEngine.getViolations().map((v) => v.message)

		// PRODUCTION HARDENING: Threshold relaxed from 10% to 15% to allow for ambitious refactors.
		// NEW pass: Stricter for "High-Traffic" nodes (afferent coupling > 10) to prevent breaking core modules.
		const isHighTraffic = (node.afferentCoupling || 0) > 10
		const dynamicThreshold = isHighTraffic ? 10 : 15
		const isSafe = scoreDrop < dynamicThreshold && violations.length === 0

		return {
			safe: isSafe,
			predictedScore: (1 - simReport.score) * 100,
			scoreDrop,
			violations,
			message: isSafe
				? "Simulation predicts stable transition."
				: `Simulation Warning: Move predicts a ${(scoreDrop).toFixed(1)}% drop in structural integrity. Review layer boundaries if this is unexpected.`,
		}
	}

	public async simulateEdit(filePath: string, content: string, currentEngine: SpiderEngine): Promise<SimulationResult> {
		const simEngine = currentEngine.clone()
		const normalizedPath = this.normalize(filePath)

		// High-Fidelity AST Simulation (v13)
		// Instead of manual property estimation, we perform a 1:1 structural index on the clone.
		simEngine.updateNode(normalizedPath, content)
		simEngine.computeCouplingMetrics()
		simEngine.computeReachability()

		const currentReport = currentEngine.computeEntropy()
		const forecast = currentEngine.forecastEntropy([{ path: normalizedPath, content }])
		const scoreDrop = (currentReport.score - forecast.predictedScore) * 100
		const violations = simEngine.getViolations().map((v) => v.message)

		return {
			safe: scoreDrop < 8,
			predictedScore: forecast.predictedScore * 100,
			scoreDrop,
			violations,
			message: scoreDrop > 8 ? "Predictive warning: Edit increases structural entropy." : "Safe edit predicted.",
		}
	}

	private cloneEngine(source: SpiderEngine): SpiderEngine {
		return source.clone()
	}

	private normalize(p: string): string {
		const abs = path.resolve(this.cwd, p)
		return path.relative(this.cwd, abs).toPosix()
	}
}
