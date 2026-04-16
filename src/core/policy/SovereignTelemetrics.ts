import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"
import { SovereignProtocol } from "./SovereignProtocol"
import { SpiderEngine } from "./spider/SpiderEngine"

/**
 * SovereignTelemetrics: The Substrate Diagnostic Layer.
 * Extracts health, entropy, and metabolic telemetry from the architectural graph.
 */
export class SovereignTelemetrics {
	private lastBuildHealth = 100

	constructor(
		private cwd: string,
		private metabolicMonitor: MetabolicMonitor,
		private spiderEngine: SpiderEngine,
	) {}

	/**
	 * Returns a compiled diagnostic report of current architectural blockades and metabolic hotspots.
	 */
	public getSystemDiagnostics(lastEntropyScore: number): string {
		const violations = this.spiderEngine.getViolations()
		const stats = this.metabolicMonitor.getVitalityStats()
		const buildHealth = this.computeBuildHealth(violations.map((v) => v.message))
		const currentEntropy = this.spiderEngine.computeEntropy()

		return SovereignProtocol.generateAuditTemplate("System Recovery", {
			buildHealth,
			metabolicPressure: `${stats.totalWrites} writes across ${this.spiderEngine.nodes.size} nodes`,
			buildErrors: violations.filter((v) => v.severity === "ERROR").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			lintWarnings: violations.filter((v) => v.severity === "WARN").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			hotspots: stats.hotspots.map((h) => `${path.basename(h.path)} (${h.stress.toFixed(2)})`),
			resonanceDamping: this.metabolicMonitor.getResonance(),
			metabolicVelocity:
				1.0 +
				(lastEntropyScore - currentEntropy.score > 0.05 ? 0.5 : 0) -
				(currentEntropy.components.couplingScore > 0.15 ? 0.5 : 0),
		})
	}

	/**
	 * Computes the build health score (0-100).
	 */
	public computeBuildHealth(violations: string[]): number {
		if (violations.length === 0) return 100

		let totalPenalty = 0
		for (const violation of violations) {
			if (violation.includes("Circular Dependency")) {
				totalPenalty += 30
			} else if (violation.includes("[ERROR]") || violation.includes("Build Error")) {
				totalPenalty += 20
			} else if (violation.includes("Geographic Misalignment") || violation.includes("Layer violation")) {
				totalPenalty += 15
			} else if (
				violation.includes("[WARN]") ||
				violation.includes("Linter Warning") ||
				violation.includes("Ghost import")
			) {
				totalPenalty += 5
			} else {
				totalPenalty += 1
			}
		}

		const base = 100
		const penalty = Math.min(95, totalPenalty)
		const score = Math.max(5, base - penalty)

		const isRecovering = score > this.lastBuildHealth
		this.lastBuildHealth = score
		this.spiderEngine.isRecovering = isRecovering

		return score
	}

	/**
	 * Returns the current metabolic and forensic status for a file.
	 */
	public getMetabolicTelemetry(filePath: string, layer: string) {
		const absPath = path.resolve(this.cwd, filePath)
		const normPath = this.spiderEngine.normalizePath(absPath)
		const currentViolations = this.spiderEngine.getViolations()

		return {
			pressure: this.metabolicMonitor.getPressure(normPath),
			resonance: this.metabolicMonitor.getResonance(),
			health: this.computeBuildHealth(currentViolations.map((v) => v.message)),
			layer,
		}
	}

	/**
	 * Resets all metabolic and structural pressure.
	 */
	public resetSystemPressure(): void {
		this.metabolicMonitor.resetMetabolicPressure()
		this.lastBuildHealth = 100
		Logger.info("[SovereignTelemetrics] Unified System Pressure Reset.")
	}
	/**
	 * Returns the resilience shield summary.
	 */
	public getResilienceShield(): string {
		const metabolic = this.metabolicMonitor.getVitalityStats()
		const hotspots = this.spiderEngine.getViolationHotspots()

		const shield = [
			"\n🛡️ UNIFIED RESILIENCE SHIELD [V12]",
			"====================================",
			`METABOLIC: ${metabolic.totalWrites} edits, ${metabolic.totalReads} reads (Doubt: ${metabolic.avgDoubtSignal.toFixed(1)})`,
			`STRUCTURAL: ${this.spiderEngine.nodes.size} nodes, ${hotspots.length} hotspots detected`,
			"====================================\n",
		]

		return shield.join("\n")
	}
}
