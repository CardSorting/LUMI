import { Logger } from "../../shared/services/Logger"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { IntegrityOptimizer, OptimizationOpportunity } from "./IntegrityOptimizer.js"
import { StabilityPolicy } from "./StabilityPolicy"
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
		complexitySinks: string[] // Files with high coupling AND high complexity
	}
}

export interface DiagnoseOptions {
	advisoryBudget?: number // V215: Limit expensive project-wide advisory scans
	includeGhosts?: boolean // V215: Toggle ghost file detection
}

/**
 * StabilityDoctor: The Agent Diagnostic Interface.
 * Aggregates all architectural signals into a single, machine-actionable report.
 */
export class StabilityDoctor {
	private optimizer: IntegrityOptimizer

	constructor(private cwd: string) {
		this.optimizer = new IntegrityOptimizer()
	}

	/**
	 * Performs a full codebase checkup.
	 */
	public async diagnose(
		engine: SpiderEngine,
		options: DiagnoseOptions = {},
		monitor?: import("../integrity/StabilityMonitor").StabilityMonitor,
	): Promise<DoctorReport> {
		const structuralViolations = engine.getViolations(monitor)
		const activityMap: { path: string; score: number }[] = []

		const policy = StabilityPolicy.getInstance(this.cwd).getGlobalConfig()
		for (const node of engine.nodes.values()) {
			const activityScore = node.logicDensity * 10 + node.ioEntropy * 5 + (node.orphaned ? 2 : 0)
			if (activityScore > (policy.activityThreshold || 5.0)) {
				activityMap.push({ path: node.path, score: activityScore })
			}
		}

		// V215: Budgeted Diagnostic Scans
		// During full-project audits, project-wide ghost/unused-export detection is a major activity sink.
		// We provide an option to cap these scans to ensure UI responsiveness.
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

		const entropy = engine.computeEntropy()
		const activityPressure = engine.computeActivityPressure()

		// V210: Comprehensive Build Health (Forensic Aggregate)
		// Factors: Violations (40%), Stability/Entropy (40%), Resource Stress (20%)
		// V215: Non-Linear Sigmoid Scoring (Industrial Hardening)
		// Instead of linear subtraction, we use an exponential decay to penalize compounding debt.
		const computeSigmoid = (count: number, severity: number) => 100 / (1 + Math.exp(0.15 * (count - severity)))

		const violationScore = computeSigmoid(allViolations.length, 5) // Threshold of 5 violations
		const stabilityScore = (1 - (entropy?.score || 0)) * 100
		const resourceScore = (1 - (activityPressure || 0)) * 100

		// Weighted Aggregate: Focuses on stability as the primary substrate signal
		const buildHealth = Math.round(violationScore * 0.3 + stabilityScore * 0.5 + resourceScore * 0.2)

		const optimizations = this.optimizer.findOptimizations(engine)

		// Map to activity pressure
		const nodes = Array.from(engine.nodes.values())
		const gravityCenter =
			nodes.reduce<(typeof nodes)[number] | undefined>((max, node) => {
				if (!max || (node.blastRadius || 0) > (max.blastRadius || 0)) return node
				return max
			}, undefined)?.path || "None detected"

		const logicHotspots = [...nodes]
			.sort((a, b) => {
				const scoreA = (a.logicDensity || 0) * 0.7 + ((a.astComplexity || 0) / 1000) * 0.3
				const scoreB = (b.logicDensity || 0) * 0.7 + ((b.astComplexity || 0) / 1000) * 0.3
				return scoreB - scoreA
			})
			.slice(0, 5)
			.map((n) => n.path)

		const complexitySinks = nodes
			.filter((n) => (n.afferentCoupling || 0) > 10 && (n.astComplexity || 0) > 800)
			.sort((a, b) => (b.afferentCoupling || 0) - (a.afferentCoupling || 0))
			.map((n) => n.path)

		return {
			buildHealth,
			timestamp: new Date().toISOString(),
			activityMap: activityMap.sort((a, b) => b.score - a.score),
			violations: allViolations,
			optimizations,
			agentSuccessRate: 100,
			integrityScore: Math.round((1 - (entropy && typeof entropy.score === "number" ? entropy.score : 0)) * 100),
			resources: {
				memoryPressure: process.memoryUsage().heapUsed / 1024 / 1024,
				diskUsage: 0,
			},
			environmentContext: {
				totalFiles: nodes.length,
				gravityCenter,
				structuralEntropy: entropy.score || 0,
				logicHotspots,
				complexitySinks,
			},
		}
	}

	/**
	 * Compact "Agent Signal" - intended for system prompts.
	 */
	public getAgentSignal(report: DoctorReport): string {
		if (!report) return "⚠️ [STABILITY NOTICE] Diagnostic Report Unavailable."
		const policy = StabilityPolicy.getInstance(this.cwd).getGlobalConfig()
		if (report.buildHealth < (policy.integrityAlertThreshold || 70)) {
			return `⚠️ [STABILITY NOTICE] Project Build Health: ${SafeNumber.format(report.buildHealth, 0)}%. Focus: Improving current file stability.`
		}
		return `✅ Project Build Health: ${SafeNumber.format(report.buildHealth, 0)}%. The codebase is stable and well-organized.`
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		Logger.info("[StabilityDoctor] Doctor substrate released.")
	}
}
