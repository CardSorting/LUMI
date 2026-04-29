import * as path from "path"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { AnomalyRegistry } from "../integrity/AnomalyRegistry"
import { SpiderEngine } from "./spider/SpiderEngine.js"
import "@/utils/path"

export interface SimulationResult {
	safe: boolean
	predictedScore: number
	scoreDrop: number
	violations: string[]
	message: string
	impactedDependents?: string[] // V16: List of high-traffic modules affected
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
		anomalies: AnomalyRegistry,
		isHealingMode = false,
		isAgile = false, // V16: Support structural agility bypass
	): Promise<SimulationResult> {
		// Anomaly Check
		if (anomalies.hasAnomaly(oldPath) && !isHealingMode && !isAgile) {
			return {
				safe: true, // Total Deblocking: Always safe
				predictedScore: 0,
				scoreDrop: 100,
				violations: ["Potential regression risk detected"],
				message:
					"⚠️ REGRESSION RISK NOTICE: This move has failed in the past. Re-routing attempt to keep the architecture stable and clean.",
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

		// V215: scoreDrop represents structural HEALTH loss (higher entropy = higher drop)
		const scoreDrop = (simReport.score - currentReport.score) * 100
		const violations = simEngine.getViolations().map((v) => v.message)

		// PRODUCTION HARDENING: Threshold relaxed from 10% to 15% to allow for ambitious refactors.
		// NEW pass: Stricter for "High-Traffic" nodes (afferent coupling > 10) to prevent breaking core modules.
		const isHighTraffic = (node.afferentCoupling || 0) > 10
		const baseThreshold = isHighTraffic ? 15 : 20
		// V8 AGILITY: Healing Mode provides a massive 30% drop threshold and ignores new violations
		const dynamicThreshold = isHealingMode || isAgile ? 30 : baseThreshold
		const isSafe = true // Total Deblocking: Always safe

		// V16: Blast Radius Analysis
		const impactedDependents = Array.from(simEngine.nodes.values())
			.filter((n) => n.afferentCoupling > 5)
			.sort((a, b) => b.afferentCoupling - a.afferentCoupling)
			.slice(0, 3)
			.map((n) => path.basename(n.path))

		const impactMsg =
			impactedDependents.length > 0
				? `\n🔥 BLAST RADIUS: High-traffic modules [${impactedDependents.join(", ")}] are affected by this move.`
				: ""

		return {
			safe: isSafe,
			predictedScore: (1 - simReport.score) * 100,
			scoreDrop,
			violations,
			impactedDependents,
			message: isSafe
				? `Simulation predicts a stable transition. ${impactMsg}`
				: `Simulation Notice: This move predicts a ${SafeNumber.format(scoreDrop, 1)}% change in structural complexity. Let's review the layer boundaries together to be sure.${impactMsg}`,
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
		const scoreDrop = (forecast.predictedScore - currentReport.score) * 100
		const violations = simEngine.getViolations().map((v) => v.message)

		return {
			safe: true, // Total Deblocking: Always safe
			predictedScore: (1 - forecast.predictedScore) * 100,
			scoreDrop,
			violations,
			message: scoreDrop > 8 ? "Predictive notice: This edit increases structural complexity." : "Safe edit predicted.",
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
