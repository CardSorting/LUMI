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

	constructor(cwd: string) {
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
		_pathogens: PathogenStore,
	): Promise<GuardSignal> {
		// 0. Architectural Exception Handshake
		if (newContent.includes("[SOVEREIGN_EXCEPTION]")) {
			// PRODUCTION HARDENING: Extract reason if provided [SOVEREIGN_EXCEPTION: reasoning...]
			const reasonMatch = newContent.match(/\[SOVEREIGN_EXCEPTION:\s*([^\]]+)\]/)
			const reason = reasonMatch
				? `Architectural Exception granted: ${reasonMatch[1].trim()}`
				: "Architectural Exception granted via [SOVEREIGN_EXCEPTION] tag."

			return {
				approved: true,
				violations: [],
				reason: reason,
			}
		}

		// 1. Simulate the impact on the structural graph
		// Extract imports for the simulation
		const importRegex = /import\s+.*from\s+["']([^"']+)["']/g
		const newImports: string[] = []
		let match: RegExpExecArray | null = importRegex.exec(newContent)
		while (match !== null) {
			newImports.push(match[1])
			match = importRegex.exec(newContent)
		}

		const simResult = await this.simulationEngine.simulateEdit(filePath, newImports, currentEngine)

		if (!simResult.safe && simResult.scoreDrop > 15) {
			return {
				approved: false,
				reason: `Integrity Drop Warning: This edit predicts a ${simResult.scoreDrop.toFixed(1)}% drop in structural integrity.`,
				violations: [],
				remediation:
					"Verify imports and ensure module is placed in the correct layer. If this change is architecturally necessary but temporarily drops integrity, you may request an override by adding [SOVEREIGN_EXCEPTION] to your file header.",
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
