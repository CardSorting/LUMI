import { SafeNumber } from "../../shared/utils/SafeNumber"
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
	environmentContext: {
		totalFiles: number
		gravityCenter: string // File with highest blast radius
		structuralEntropy: number
		logicHotspots: string[] // Top 3 logic-dense files
		metabolicSinks: string[] // Files with high coupling AND high complexity
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

		const advisories = engine.getIntegrityAdvisories()
		const allViolations = [
			...structuralViolations.map((v) => ({
				type: "STRUCTURAL" as const,
				message: v.message,
				path: v.path,
				remediation: v.remediation || "Check documentation.",
			})),
			...advisories.map((a) => ({
				type: "STRUCTURAL" as const,
				message: a.message,
				path: a.path,
				remediation: "Structural adjustment required.",
			})),
		]

		const buildHealth = Math.max(0, 100 - allViolations.length * 10)

		// Map to metabolic pressure
		const entropy = engine.computeEntropy()

		const nodes = Array.from(engine.nodes.values())
		const gravityCenter = nodes.sort((a, b) => b.blastRadius - a.blastRadius)[0]?.path || "Unknown"
		const logicHotspots = nodes
			.sort((a, b) => b.logicDensity - a.logicDensity)
			.slice(0, 3)
			.map((n) => n.path)

		const metabolicSinks = nodes.filter((n) => n.afferentCoupling > 10 && (n.astComplexity || 0) > 1000).map((n) => n.path)

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
			environmentContext: {
				totalFiles: nodes.length,
				gravityCenter,
				structuralEntropy: entropy.score,
				logicHotspots,
				metabolicSinks,
			},
		}
	}

	/**
	 * Compact "Agent Signal" - intended for system prompts.
	 */
	public getAgentSignal(report: DoctorReport): string {
		if (!report) return "⚠️ [STABILITY NOTICE] Diagnostic Report Unavailable."
		const policy = SovereignPolicy.getInstance(this.cwd).getGlobalConfig()
		if (report.buildHealth < (policy.integrityAlertThreshold || 70)) {
			return `⚠️ [STABILITY NOTICE] Project Build Health: ${SafeNumber.format(report.buildHealth, 0)}%. Focus: Improving current file stability.`
		}
		return `✅ Project Build Health: ${SafeNumber.format(report.buildHealth, 0)}%. The codebase is stable and well-organized.`
	}
}
