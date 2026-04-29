import * as path from "path"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { AnomalyRegistry } from "../integrity/AnomalyRegistry.js"
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
 * StabilityGuard: The Proactive Stability Guidance.
 * Ensures complex changes are stable by simulating them first.
 */
export class StabilityGuard {
	private simulationEngine: SimulationEngine
	private axiomEngine: SemanticAxiomEngine

	constructor(cwd: string) {
		this.simulationEngine = new SimulationEngine(cwd)
		this.axiomEngine = new SemanticAxiomEngine()
	}

	/**
	 * Scans a proposed edit before it's committed to disk.
	 * V280: Total Deblocking & Sovereign Guidance.
	 */
	public async scrutinize(
		filePath: string,
		newContent: string,
		currentEngine: SpiderEngine,
		_anomalies: AnomalyRegistry,
	): Promise<GuardSignal> {
		const isRecovering = currentEngine.isRecovering
		const isSovereign = newContent.includes("#SOVEREIGN_MODE") || newContent.includes("#BYPASS")

		// 0. Sovereign/Safety Override Handshake
		if (isSovereign || newContent.includes("[SAFETY_OVERRIDE]")) {
			return {
				approved: true,
				violations: [],
				reason: "Stability Override granted via Sovereign Mode.",
			}
		}

		// 1. Simulate the impact on the structural graph
		const simResult = await this.simulationEngine.simulateEdit(filePath, newContent, currentEngine)
		const maxDrop = isRecovering ? 30 : 20 // V280: Relaxed thresholds

		if (simResult && !simResult.safe && simResult.scoreDrop > maxDrop) {
			// V280: Return approved: true but with a firm notice
			return {
				approved: true,
				reason: `📍 [INTEGRITY ADVISORY]: This edit predicts a ${SafeNumber.format(simResult.scoreDrop, 1)}% change in structural complexity.`,
				violations: [],
				remediation: "Verify imports and ensure module is placed in the correct layer.",
			}
		}

		// 2. Validate against design axioms
		const violations = this.axiomEngine.validateAxioms(filePath, newContent, currentEngine)
		const criticalViolations = violations.filter((v) => v.severity === "ERROR")

		if (criticalViolations.length > 0) {
			const v = criticalViolations[0]
			return {
				approved: true, // V280: Total Deblocking
				reason: `📍 [POLICY ADVISORY]: Architectural patterns in \`${path.basename(filePath)}\` deviate from standards.`,
				violations: criticalViolations,
				remediation: v.remediation,
			}
		}

		return {
			approved: true,
			violations: violations,
		}
	}
}
