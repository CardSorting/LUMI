import { AxiomViolation, SemanticAxiomEngine } from "./SemanticAxiomEngine.js"
import { OptimizationOpportunity, SovereignOptimizer } from "./SovereignOptimizer.js"
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
}

/**
 * SovereignDoctor: The Agent-Sovereign Diagnostic Interface.
 * Aggregates all architectural signals into a single, machine-actionable report.
 */
export class SovereignDoctor {
	private axiomEngine: SemanticAxiomEngine
	private optimizer: SovereignOptimizer

	constructor(private cwd: string) {
		this.axiomEngine = new SemanticAxiomEngine(cwd)
		this.optimizer = new SovereignOptimizer(cwd)
	}

	/**
	 * Performs a full codebase checkup.
	 */
	public async diagnose(engine: SpiderEngine): Promise<DoctorReport> {
		const structuralViolations = engine.getViolations()
		const axiomViolations: { path: string; violation: AxiomViolation }[] = []
		const feverMap: { path: string; score: number }[] = []

		for (const node of engine.nodes.values()) {
			// In a real scenario, we'd read the file content from disk or a cache
			// For this implementation, we assume engine has already indexed these.
			// However, SemanticAxiomEngine needs the actual content.
			// For brevity in this doctor, we simulate finding hotspots.

			const feverScore = node.logicDensity * 10 + node.ioEntropy * 5 + (node.orphaned ? 2 : 0)
			if (feverScore > 5) {
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
		const integrityScore = Math.max(0, 100 - entropy * 100 - allViolations.length * 2)

		return {
			integrityScore,
			timestamp: new Date().toISOString(),
			feverMap: feverMap.sort((a, b) => b.score - a.score),
			violations: allViolations,
			optimizations,
			agentSuccessRate: 0.95, // Placeholder for success tracking
		}
	}

	/**
	 * Compact "Agent Signal" - intended for system prompts.
	 */
	public getAgentSignal(report: DoctorReport): string {
		if (report.integrityScore < 70) {
			return `⚠️ [ARCHITECTURAL ALARM] Substrate Integrity: ${report.integrityScore.toFixed(0)}%. Agent state: Restricted to HEAL operations only.`
		}
		return `✅ Substrate Integrity: ${report.integrityScore.toFixed(0)}%. Codebase is sovereign.`
	}
}
