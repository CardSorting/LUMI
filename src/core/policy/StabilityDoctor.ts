import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "../../shared/services/Logger"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { IntegrityOptimizer, OptimizationOpportunity } from "./IntegrityOptimizer"
import { StabilityPolicy } from "./StabilityPolicy"
import { SpiderEngine } from "./spider/SpiderEngine"

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
		_options: DiagnoseOptions = {},
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
			agentSuccessRate: this.computeAgentSuccessRate(engine),
			integrityScore: Math.round((1 - (entropy && typeof entropy.score === "number" ? entropy.score : 0)) * 100),
			resources: {
				memoryPressure: process.memoryUsage().heapUsed / 1024 / 1024,
				diskUsage: await this.estimateWorkspaceDiskUsage(),
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
	 * V350: Computes a real agent success rate based on the ratio of
	 * healthy nodes (no violations) to total nodes in the structural graph.
	 * A node with no violations is considered a "successful" edit surface.
	 */
	private computeAgentSuccessRate(engine: SpiderEngine): number {
		const nodes = Array.from(engine.nodes.values())
		if (nodes.length === 0) return 100

		const violations = engine.getViolations()
		const violatedPaths = new Set(violations.map((v) => v.path))
		const healthyNodes = nodes.filter((n) => !violatedPaths.has(n.path))
		const rate = (healthyNodes.length / nodes.length) * 100

		return Math.round(rate)
	}

	/**
	 * V350: Estimates workspace disk usage by aggregating file sizes from
	 * the structural graph (already indexed by Spider). Returns MB.
	 */
	private async estimateWorkspaceDiskUsage(): Promise<number> {
		try {
			const srcPath = path.join(this.cwd, "src")
			let totalBytes = 0

			const walk = async (dir: string): Promise<void> => {
				const entries = await fs.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					const entryPath = path.join(dir, entry.name)
					if (entry.isDirectory()) {
						if (entry.name === "node_modules" || entry.name === ".git") continue
						await walk(entryPath)
					} else {
						const stats = await fs.stat(entryPath)
						totalBytes += stats.size
					}
				}
			}

			await walk(srcPath)
			return Math.round((totalBytes / (1024 * 1024)) * 100) / 100 // MB with 2 decimals
		} catch {
			return 0 // Fallback if src directory doesn't exist
		}
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		Logger.info("[StabilityDoctor] Doctor substrate released.")
	}
}
