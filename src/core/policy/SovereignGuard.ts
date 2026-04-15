import * as path from "path"
import { PathogenStore } from "../integrity/PathogenStore.js"
import { AxiomViolation, SemanticAxiomEngine } from "./SemanticAxiomEngine.js"
import { SimulationEngine } from "./SimulationEngine.js"
import { SpiderEngine } from "./spider/SpiderEngine.js"

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
		const isRecovering = currentEngine.isRecovering

		// 0. Architectural Exception Handshake
		if (newContent.includes("[SOVEREIGN_EXCEPTION]")) {
			// PRODUCTION HARDENING: Require substantive reasoning for exceptions.
			const reasonMatch = newContent.match(/\[SOVEREIGN_EXCEPTION:\s*([^\]]+)\]/)
			const reasonText = reasonMatch ? reasonMatch[1].trim() : ""

			// V9: Relax length requirement if project is recovering
			const minLength = isRecovering ? 10 : 20
			if (reasonText.length < minLength) {
				return {
					approved: false,
					reason: `🛑 INVALID EXCEPTION: The [SOVEREIGN_EXCEPTION] tag requires a substantive reason (min ${minLength} characters).`,
					violations: [],
					remediation:
						"Provide a clear architectural justification for bypassing the integrity guard (e.g. [SOVEREIGN_EXCEPTION: Temporary circularity for migration]).",
				}
			}

			return {
				approved: true,
				violations: [],
				reason: `Architectural Exception granted: ${reasonText}`,
			}
		}

		// 1. Simulate the impact on the structural graph (v13 High-Fidelity)
		// V9: Pass isRecovering as isHealingMode to SimulationEngine
		const simResult = await this.simulationEngine.simulateEdit(filePath, newContent, currentEngine)

		// V9: Dynamic Leniency sync with SimulationEngine
		const maxDrop = isRecovering ? 25 : 15
		if (!simResult.safe && simResult.scoreDrop > maxDrop) {
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
			const v = criticalViolations[0]
			const fixSnippet = v.remediationSnippet
				? `\n\n💡 RECOMMENDED FIX:\n\`\`\`typescript\n${v.remediationSnippet}\n\`\`\``
				: ""

			return {
				approved: false,
				reason: `🛑 AXIOMATIC BREACH: Proactive interdiction triggered in \`${path.basename(filePath)}\`.`,
				violations: criticalViolations,
				remediation: `${v.remediation}${fixSnippet}`,
			}
		}

		return {
			approved: true,
			violations: violations,
		}
	}
}
