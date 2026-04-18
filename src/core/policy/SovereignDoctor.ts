import { OptimizationOpportunity, SovereignOptimizer } from "./SovereignOptimizer.js"
import { SovereignPolicy } from "./SovereignPolicy"
import { SpiderEngine } from "./spider/SpiderEngine.js"

export interface DoctorReport {
	buildHealth: number
	timestamp: string
	activityMap: { path: string; score: number }[]
	violations: {
		type: "POLICY" | "STRUCTURAL"
		axiom?: string
		message: string
		path: string
		remediation: string
	}[]
	optimizations: OptimizationOpportunity[]
	agentSuccessRate: number
	integrityScore: number // V100: Structural integrity (0-100)
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
		const activityMap: { path: string; score: number }[] = []

		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		for (const node of engine.nodes.values()) {
			const activityScore = node.logicDensity * 10 + node.ioEntropy * 5 + (node.orphaned ? 2 : 0)
			if (activityScore > (policy.activityThreshold || 5.0)) {
				activityMap.push({ path: node.path, score: activityScore })
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

		const buildHealth = Math.max(0, 100 - allViolations.length * 10)

		// Map to metabolic pressure
		const entropy = engine.computeEntropy()

		return {
			buildHealth,
			timestamp: new Date().toISOString(),
			activityMap: activityMap.sort((a, b) => b.score - a.score),
			violations: allViolations,
			optimizations,
			agentSuccessRate: 100, // Placeholder
			integrityScore: entropy.score * 100,
			resources: {
				memoryPressure: process.memoryUsage().heapUsed / 1024 / 1024,
				diskUsage: 0, // V100: Placeholder for stats fix
			},
		}
	}

	/**
	 * Compact "Agent Signal" - intended for system prompts.
	 */
	public getAgentSignal(report: DoctorReport): string {
		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		if (report.buildHealth < (policy.integrityAlertThreshold || 70)) {
			return `⚠️ [STABILITY NOTICE] Project Build Health: ${report.buildHealth.toFixed(0)}%. Focus: Improving current file stability.`
		}
		return `✅ Project Build Health: ${report.buildHealth.toFixed(0)}%. The codebase is stable and well-organized.`
	}
}
