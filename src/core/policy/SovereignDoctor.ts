import { OptimizationOpportunity, SovereignOptimizer } from "./SovereignOptimizer.js"
import { SovereignPolicy } from "./SovereignPolicy"
import { SpiderEngine } from "./SpiderEngine.js"

export interface DoctorReport {
	integrityScore: number
	timestamp: string
	feverMap: { path: string; score: number }[]
	violations: {
		type: "AXIOM" | "STRUCTURAL"
		axiom?: string
		message: string
		path: string
		remediation: string
	}[]
	optimizations: OptimizationOpportunity[]
	agentSuccessRate: number
	resources: {
		memoryPressure: number
		diskUsage: number
	}
}

/**
 * SovereignDoctor: The Agent-Sovereign Diagnostic Interface.
 * Aggregates all architectural signals into a single, machine-actionable report.
 */
export class SovereignDoctor {
	private optimizer: SovereignOptimizer

	constructor(private cwd: string) {
		this.optimizer = new SovereignOptimizer()
	}

	/**
	 * Performs a full codebase checkup.
	 */
	public async diagnose(engine: SpiderEngine): Promise<DoctorReport> {
		const structuralViolations = engine.getViolations()
		const feverMap: { path: string; score: number }[] = []

		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		for (const node of engine.nodes.values()) {
			const feverScore = node.logicDensity * 10 + node.ioEntropy * 5 + (node.orphaned ? 2 : 0)
			if (feverScore > policy.feverThreshold) {
				feverMap.push({ path: node.path, score: feverScore })
			}
		}

		const optimizations = this.optimizer.findOptimizations(engine)

		const allViolations = [
			...structuralViolations.map((v) => ({
				type: "STRUCTURAL" as const,
				message: v.message,
				path: v.path,
				remediation: v.remediation || "Check documentation.",
			})),
			// Axiom violations would normally be added here by iterating files
		]

		const entropy = engine.computeEntropy().score
		const integrityScore = Math.max(0, 100 - entropy * 50 - allViolations.length * 5)

		// Map to metabolic pressure
		const mem = process.memoryUsage()
		const memoryPressure = (mem.heapUsed / mem.heapTotal) * 100

		return {
			integrityScore,
			timestamp: new Date().toISOString(),
			feverMap: feverMap.sort((a, b) => b.score - a.score),
			violations: allViolations,
			optimizations,
			agentSuccessRate: 0.95,
			resources: {
				memoryPressure,
				diskUsage: 0, // Placeholder
			},
		}
	}

	/**
	 * Compact "Agent Signal" - intended for system prompts.
	 */
	public getAgentSignal(report: DoctorReport): string {
		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		if (report.integrityScore < policy.integrityAlertThreshold) {
			return `⚠️ [ARCHITECTURAL ALARM] Substrate Integrity: ${report.integrityScore.toFixed(0)}%. Agent state: Restricted to HEAL operations only.`
		}
		return `✅ Substrate Integrity: ${report.integrityScore.toFixed(0)}%. Codebase is sovereign.`
	}
}
