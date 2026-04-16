import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { MetabolicMonitor } from "../integrity/MetabolicMonitor"
import { PathogenStore } from "../integrity/PathogenStore"
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
		private pathogens: PathogenStore,
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
			agenticThrashing: this.getAgenticHealth(),
			healthTrend: buildHealth - this.lastBuildHealth,
			vitalityPulse: this.getSubstrateVitality(),
			neuralFocus: this.getNeuralFocus(),
			aestheticResilience: stats.aestheticResilience,
			recoveryHint: this.getRecoveryHint(this.getSubstrateVitality()),
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
		return `💓 FLATLINE WARNING: Vitality Pulse is at ${vitality.toFixed(0)}%. You MUST perform a # SOVEREIGN BREATH to clear metabolic inflammation before the substrate locks.`
	}

	/**
	 * V187: Computes the 💓 Vitality Pulse based on pressure, doubt, and fragility.
	 */
	public getSubstrateVitality(): number {
		const stats = this.metabolicMonitor.getVitalityStats()
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

		const namingIntegrity = nodes.reduce((acc, n) => acc + (n.namingScore || 1.0), 0) / (nodes.length || 1)
		const merkleDrift = this.spiderEngine.computeMerkleRoot()

		return {
			fragilityIndex: fragilityScores,
			namingIntegrity,
			merkleDrift,
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
	public getMetabolicTelemetry(filePath: string, layer: string, tokens = 0) {
		const absPath = path.resolve(this.cwd, filePath)
		const normPath = this.spiderEngine.normalizePath(absPath)
		const currentViolations = this.spiderEngine.getViolations()

		return {
			pressure: this.metabolicMonitor.getPressure(normPath),
			resonance: this.metabolicMonitor.getResonance(),
			health: this.computeBuildHealth(currentViolations.map((v) => v.message)),
			tokens,
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
