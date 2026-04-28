import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"
import { PathogenStore } from "../integrity/PathogenStore"
import { SovereignProtocol } from "./SovereignProtocol"
import { SpiderEngine } from "./spider/SpiderEngine"

/**
 * SystemTelemetrics: The Substrate Diagnostic Layer.
 * Extracts health, entropy, and vitality telemetry from the architectural graph.
 */
export class SovereignTelemetrics {
	private lastBuildHealth = 100

	constructor(
		private cwd: string,
		private metabolicMonitor: MetabolicMonitor,
		private spiderEngine: SpiderEngine,
		private pathogens: PathogenStore,
	) {}

	/**
	 * Returns a compiled diagnostic report of current architectural blockades and vitality hotspots.
	 */
	public getSystemDiagnostics(lastEntropyScore: number): string {
		const violations = this.spiderEngine.getViolations()
		const stats = this.metabolicMonitor.getStabilityStats()
		const buildHealth = this.computeBuildHealth(violations.map((v) => v.message))
		const currentEntropy = this.spiderEngine.computeEntropy()

		return SovereignProtocol.generateAuditTemplate("System Recovery", {
			buildHealth,
			workloadLevel: `${stats.totalWrites} writes across ${this.spiderEngine.nodes.size} nodes`,
			buildErrors: violations.filter((v) => v.severity === "ERROR").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			lintWarnings: violations.filter((v) => v.severity === "WARN").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			hotspots: stats.hotspots.map((h) => `${path.basename(h.path)} (${SafeNumber.format(h.stress, 2)})`),
			resonanceDamping: this.metabolicMonitor.getResonance(),
			projectVelocity:
				1.0 +
				(lastEntropyScore - currentEntropy.score > 0.05 ? 0.5 : 0) -
				(currentEntropy.components.couplingScore > 0.15 ? 0.5 : 0),
			agenticThrashing: this.getAgenticHealth(),
			healthTrend: buildHealth - this.lastBuildHealth,
			heartbeatStatus: this.getStabilityPulse(),
			neuralFocus: this.getNeuralFocus(),
			aestheticResilience: stats.aestheticResilience,
			recoveryHint: this.getRecoveryHint(this.getStabilityPulse()),
			...this.getStructuralForensics(),
		})
	}

	/**
	 * V188: Surfaces the top cognitive focus symbols from the neural registry.
	 */
	public getNeuralFocus(): string[] {
		const focusMap = new Map<string, number>()
		const forensic = this.metabolicMonitor.getForensicRegistry()

		for (const m of forensic.values()) {
			for (const symbol of m.symbolObservations) {
				focusMap.set(symbol, (focusMap.get(symbol) || 0) + 1)
			}
		}

		return Array.from(focusMap.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([name]) => name)
	}

	/**
	 * V188: Generates a recovery strategy if Vitality is flatlining.
	 */
	public getRecoveryHint(vitality: number): string | undefined {
		if (vitality > 40) return undefined
		return `💓 STABILITY WARNING: Heartbeat signal is at ${SafeNumber.format(vitality, 0)}%. 
  STEP 1: Implement a Strategic Stability Break. Simplify your current changes.
  STEP 2: Trigger a # STRATEGIC REVIEW in \`scratchpad.md\` to re-ground your plan.`
	}

	/**
	 * V187: Computes the 💓 Stability Pulse based on workload, doubt, and complexity.
	 */
	public getStabilityPulse(): number {
		const stats = this.metabolicMonitor.getStabilityStats()
		const nodes = Array.from(this.spiderEngine.nodes.values())

		const pressurePenalty = Math.min(stats.avgPressure * 2, 40)
		const doubtPenalty = Math.min(stats.avgDoubtSignal / 2, 30)
		const fragilityPenalty = (nodes.filter((n) => n.astComplexity > 2000).length / (nodes.length || 1)) * 30

		return Math.max(0, 100 - pressurePenalty - doubtPenalty - fragilityPenalty)
	}

	/**
	 * V186: Performs a deep structural audit of identifier casing, fragility, and substrate drift.
	 */
	public getStructuralForensics() {
		const fragilityScores: Record<string, number> = {}
		const nodes = Array.from(this.spiderEngine.nodes.values())

		// Sampling top nodes for fragility
		for (const node of nodes.slice(0, 20)) {
			fragilityScores[path.basename(node.path)] = this.spiderEngine.computeCCI(
				node.path,
				this.pathogens,
				this.metabolicMonitor,
			)
		}

		const namingIntegrity =
			nodes.reduce((acc, n) => acc + (n.namingScore !== undefined ? n.namingScore : 1.0), 0) / (nodes.length || 1)
		const merkleDrift = this.spiderEngine.computeMerkleRoot()

		return {
			fragilityIndex: fragilityScores,
			namingIntegrity: namingIntegrity,
			merkleDrift: merkleDrift,
		}
	}

	/**
	 * V185: Evaluates the "Success Flow" of the agent.
	 * Detects recursive loops and investigative doubt.
	 */
	public getAgenticHealth(): { loop: boolean; doubtFiles: string[] } {
		const loop = this.metabolicMonitor.detectRecursiveLoop()
		const forensic = this.metabolicMonitor.getForensicRegistry()
		const doubtFiles = Array.from(forensic.entries())
			.filter(([p, m]) => this.metabolicMonitor.getDoubtSignal(p) > 10)
			.map(([p]) => path.basename(p))

		return {
			loop: loop.loop,
			doubtFiles,
		}
	}

	/**
	 * Computes the build health score (0-100).
	 * V189: Hardened with Dynamic Scale Normalization.
	 */
	public computeBuildHealth(violations: string[]): number {
		if (violations.length === 0) return 100

		const nodeCount = this.spiderEngine.nodes.size || 1
		// Large projects (1000+ nodes) have more surface area for warnings.
		// Scale factor reduces penalty intensity proportional to project scale.
		const scaleFactor = Math.max(0.2, 1.0 / (Math.log10(Math.max(10, nodeCount)) / 1.5))

		let totalPenalty = 0
		for (const violation of violations) {
			if (violation.includes("Circular Dependency")) {
				totalPenalty += 30 * scaleFactor
			} else if (violation.includes("[ERROR]") || violation.includes("Build Error")) {
				totalPenalty += 20 * scaleFactor
			} else if (violation.includes("Geographic Misalignment") || violation.includes("Layer violation")) {
				totalPenalty += 15 * scaleFactor
			} else if (
				violation.includes("[WARN]") ||
				violation.includes("Linter Warning") ||
				violation.includes("Ghost import")
			) {
				totalPenalty += 5 * scaleFactor
			} else {
				totalPenalty += 1 * scaleFactor
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
	 * Returns the current stability and investigation status for a file.
	 */
	public getStabilityTelemetry(filePath: string, layer: string, tokens = 0) {
		const absPath = path.resolve(this.cwd, filePath)
		const normPath = this.spiderEngine.normalizePath(absPath)
		const currentViolations = this.spiderEngine.getViolations()

		return {
			pressure: this.metabolicMonitor.getPressure(normPath),
			resonance: this.metabolicMonitor.getResonance(),
			health: this.computeBuildHealth(currentViolations.map((v) => v.message)),
			vitalityPulse: this.getStabilityPulse(),
			tokens,
			layer,
		}
	}

	/**
	 * V189: Industrial Hardening - Structured Telemetry Snapshot.
	 */
	public getTelemetrySnapshot() {
		const violations = this.spiderEngine.getViolations()
		const stats = this.metabolicMonitor.getStabilityStats()

		return {
			timestamp: Date.now(),
			health: this.computeBuildHealth(violations.map((v) => v.message)),
			pulse: this.getStabilityPulse(),
			entropy: this.spiderEngine.computeEntropy(),
			merkle: this.spiderEngine.computeMerkleRoot(),
			activity: {
				reads: stats.totalReads,
				writes: stats.totalWrites,
				pressure: stats.avgPressure,
			},
		}
	}

	/**
	 * V189: Immortalizes the telemetry trends.
	 */
	public exportState(): { lastBuildHealth: number } {
		return {
			lastBuildHealth: this.lastBuildHealth,
		}
	}

	/**
	 * V189: Restores telemetry trends.
	 */
	public importState(state: { lastBuildHealth: number }) {
		if (state && typeof state.lastBuildHealth === "number") {
			this.lastBuildHealth = state.lastBuildHealth
		}
	}

	/**
	 * Resets all project pressure.
	 */
	public resetSystemPressure(): void {
		this.metabolicMonitor.resetMetabolicPressure(true) // V189: Transient reset
		this.lastBuildHealth = 100
		Logger.info("[StabilityTelemetrics] Unified Project Pressure Reset (Transient).")
	}

	/**
	 * Returns the resilience shield summary.
	 */
	public getResilienceShield(): string {
		const metabolic = this.metabolicMonitor.getStabilityStats()
		const hotspots = this.spiderEngine.getViolationHotspots()

		const shield = [
			"\n🛡️ PROJECT PROTECTION SUMMARY [V12]",
			"====================================",
			`ACTIVITY: ${metabolic.totalWrites} edits, ${metabolic.totalReads} reads (Activity Ratio: ${SafeNumber.format(metabolic.avgDoubtSignal, 1)})`,
			`STRUCTURE: ${this.spiderEngine.nodes.size} nodes, ${hotspots.length} high-change areas detected`,
			"====================================\n",
		]

		return shield.join("\n")
	}
}
