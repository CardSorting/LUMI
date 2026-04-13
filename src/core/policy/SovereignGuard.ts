import { PathogenStore } from "../integrity/PathogenStore.js"
import { AxiomViolation, SemanticAxiomEngine } from "./SemanticAxiomEngine.js"
import { SimulationEngine } from "./SimulationEngine.js"
import { SpiderEngine } from "./SpiderEngine.js"

export interface GuardSignal {
	approved: boolean
	reason?: string
	violations: AxiomViolation[]
	remediation?: string
}

/**
 * SovereignGuard: The Proactive Interdiction Middleware.
 * Prevents "Toxic Edits" from entering the codebase by simulating them first.
 */
export class SovereignGuard {
	private simulationEngine: SimulationEngine
	private axiomEngine: SemanticAxiomEngine

	constructor(private cwd: string) {
		this.simulationEngine = new SimulationEngine(cwd)
		this.axiomEngine = new SemanticAxiomEngine(cwd)
	}

	/**
	 * Scans a proposed edit before it's committed to disk.
	 */
	public async scrutinize(
		filePath: string,
		newContent: string,
		currentEngine: SpiderEngine,
		pathogens: PathogenStore,
	): Promise<GuardSignal> {
		// 1. Simulate the impact on the structural graph
		// Extract imports for the simulation
		const importRegex = /import\s+.*from\s+["']([^"']+)["']/g
		const newImports: string[] = []
		let match
		while ((match = importRegex.exec(newContent)) !== null) {
			newImports.push(match[1])
		}

		const simResult = await this.simulationEngine.simulateEdit(filePath, newImports, currentEngine)

		if (!simResult.safe && simResult.scoreDrop > 15) {
			return {
				approved: false,
				reason: `Integrity Drop Warning: This edit predicts a ${simResult.scoreDrop.toFixed(1)}% drop in structural integrity.`,
				violations: [],
				remediation: "Verify imports and ensure module is placed in the correct layer.",
			}
		}

		// 2. Validate against design axioms using virtual state
		// We temporarily "patch" the engine for the axiom check if we don't want to clone it twice
		// But for high-fidelity, we should use the simResult if it exposed the cloned engine.
		// Since simulateEdit doesn't return the engine, we perform a targeted axiom check on the content.

		const violations = this.axiomEngine.validateAxioms(filePath, newContent, currentEngine)

		const criticalViolations = violations.filter((v) => v.severity === "ERROR")

		if (criticalViolations.length > 0) {
			return {
				approved: false,
				reason: "Axiomatic Breach: Proactive interdiction triggered.",
				violations: criticalViolations,
				remediation: criticalViolations[0].remediation,
			}
		}

		return {
			approved: true,
			violations: violations,
		}
	}
}
