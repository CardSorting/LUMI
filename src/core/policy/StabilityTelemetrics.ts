import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { SafeNumber } from "../../shared/utils/SafeNumber"
import { AnomalyRegistry } from "../integrity/AnomalyRegistry"
import { StabilityMonitor } from "../integrity/StabilityMonitor"
import { IntegrityProtocol } from "./IntegrityProtocol"
import { SpiderEngine } from "./spider/SpiderEngine"

/**
 * SystemTelemetrics: The System Telemetry Layer.
 * Extracts health, complexity, and activity telemetry from the architectural graph.
 */
export class StabilityTelemetrics {
	private lastBuildHealth = 100

	constructor(
		private cwd: string,
		private stabilityMonitor: StabilityMonitor,
		private spiderEngine: SpiderEngine,
		private anomalies: AnomalyRegistry,
	) {}

	/**
	 * Returns a compiled diagnostic report of current architectural blockades and vitality hotspots.
	 */
	public getSystemDiagnostics(lastEntropyScore: number): string {
		const violations = this.spiderEngine.getViolations()
		const stats = this.stabilityMonitor.getStabilityStats()
		const buildHealth = this.computeBuildHealth(violations)
		const currentEntropy = this.spiderEngine.computeEntropy()

		return IntegrityProtocol.generateAuditTemplate("System Recovery", {
			buildHealth,
			workloadLevel: `${stats.totalWrites} writes across ${this.spiderEngine.nodes.size} nodes`,
			buildErrors: violations.filter((v) => v.severity === "ERROR").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			lintWarnings: violations.filter((v) => v.severity === "WARN").map((v) => `[${v.id}] ${v.path}: ${v.message}`),
			hotspots: stats.hotspots.map((h) => `${path.basename(h.path)} (${SafeNumber.format(h.stress, 2)})`),
			velocityMultiplier: this.stabilityMonitor.getVelocityDamping(),
			projectVelocity:
				1.0 +
				(lastEntropyScore - currentEntropy.score > 0.05 ? 0.5 : 0) -
				(currentEntropy.components.couplingScore > 0.15 ? 0.5 : 0),
			agenticThrashing: this.getAgenticHealth(),
			healthTrend: buildHealth - this.lastBuildHealth,
			activityLevel: this.getStabilityPulse(),
			neuralFocus: this.getNeuralFocus(),
			aestheticResilience: stats.aestheticResilience,
			recoveryHint: this.getRecoveryHint(this.getStabilityPulse()),
			// V230: Forensic Prophecy Integration
			suggestedRepairs: this.getHazardAnalysis(),
			...this.getStructuralForensics(),
		})
	}

	/**
	 * V230: Performs a multivariate hazard analysis to identify imminent structural risks.
	 */
	private getHazardAnalysis(): string[] {
		const nodes = Array.from(this.spiderEngine.nodes.values())
		const repairs: string[] = []

		// 1. Identify High-Hazard Nodes
		const highHazard = nodes
			.filter((n) => n.hazardScore > 0.6)
			.sort((a, b) => b.hazardScore - a.hazardScore)
			.slice(0, 3)

		for (const node of highHazard) {
			repairs.push(
				`High Hazard [Score: ${SafeNumber.format(node.hazardScore, 2)}] in ${path.basename(node.path)}. Potential structural drift or statistical outlier.`,
			)
		}

		// 2. Identify High-Blast Radius Fragility
		const fragile = nodes
			.filter((n) => n.isFragile && n.blastRadius > 0.7)
			.sort((a, b) => b.blastRadius - a.blastRadius)
			.slice(0, 2)

		for (const node of fragile) {
			repairs.push(
				`Critical Fragility [Radius: ${SafeNumber.format(node.blastRadius, 2)}] in ${path.basename(node.path)}. Decompose to reduce ripple probability.`,
			)
		}

		return repairs
	}

	/**
	 * V188: Surfaces the top cognitive focus symbols from the neural registry.
	 */
	public getNeuralFocus(): string[] {
		const focusMap = new Map<string, number>()
		const forensic = this.stabilityMonitor.getForensicRegistry()

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
		return `⚠️ STABILITY WARNING: Activity level (Churn) is at ${SafeNumber.format(vitality, 0)}%. 
  STEP 1: Implement a Strategic Stability Break. Simplify your current changes.
  STEP 2: Trigger a # STRATEGIC REVIEW in \`scratchpad.md\` to re-ground your plan.`
	}

	/**
	 * V187: Computes the Activity Level (Churn) based on workload, doubt, and complexity.
	 */
	public getStabilityPulse(): number {
		const stats = this.stabilityMonitor.getStabilityStats()
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
				this.anomalies,
				this.stabilityMonitor,
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
		const loop = this.stabilityMonitor.detectRecursiveLoop()
		const forensic = this.stabilityMonitor.getForensicRegistry()
		const doubtFiles = Array.from(forensic.entries())
			.filter(([p, _m]) => this.stabilityMonitor.getDoubtSignal(p) > 10)
			.map(([p]) => path.basename(p))

		return {
			loop: loop.loop,
			doubtFiles,
		}
	}

	/**
	 * Computes the build health score (0-100).
	 * V250: Surgical Local Isolation - Eliminating Global Noise.
	 */
	public computeBuildHealth(violations: any[], focusPath?: string): number {
		if (violations.length === 0) return 100

		const nodeCount = this.spiderEngine.nodes.size || 1
		// Large projects have more surface area; scale factor reduces global penalty intensity.
		const scaleFactor = Math.max(0.05, 1.0 / (Math.log10(Math.max(10, nodeCount)) / 1.1))

		let localPenalty = 0
		let globalPenalty = 0

		// Distance Cache to avoid repeated BFS for the same focusPath
		const distanceMap = new Map<string, number>()
		if (focusPath && this.spiderEngine.nodes.has(focusPath)) {
			this.calculateGraphDistances(focusPath, distanceMap)
		}

		for (const violation of violations) {
			const vPath = violation.path
			let weight = 0.001 // V250: Global noise floor reduced (was 0.01)
			let isLocal = false

			if (focusPath && vPath === focusPath) {
				weight = 1.0 // Direct impact
				isLocal = true
			} else if (vPath === "PROJECT_ROOT" || vPath === "SUBSTRATE") {
				weight = 0.3 // V250: Reduced foundational weight (was 0.5)
				isLocal = true
			} else if (focusPath) {
				const distance = distanceMap.get(vPath) ?? 10 // Default to distant
				if (distance === 1) {
					weight = 0.75
					isLocal = true
				} else if (distance === 2) {
					weight = 0.4
					isLocal = true
				} // V250: Reduced transitive weight
				else if (distance === 3) {
					weight = 0.1
				} else if (path.dirname(vPath) === path.dirname(focusPath)) {
					weight = 0.1
					isLocal = true
				}
			}

			const msg = violation.message || ""
			let penalty = 0

			// Semantic Penalty Mapping (Industrial Standards)
			if (msg.includes("CIRCULAR DEPENDENCY") || violation.id === "SPI-201") {
				penalty = 40
			} else if (msg.includes("AXIOMATIC VIOLATION") || violation.id === "SPI-206") {
				penalty = 35
			} else if (msg.includes("STRUCTURAL LOAD") || violation.id === "SPI-203") {
				penalty = 30
			} else if (violation.severity === "ERROR") {
				penalty = 20
			} else if (msg.includes("SYSTEMIC RISK") || violation.id === "SPI-202") {
				penalty = 15
			} else if (violation.severity === "WARN") {
				penalty = 5
			} else {
				penalty = 2
			}

			// V230: Forensic Amplification (Only for local or foundational nodes)
			if (isLocal) {
				const node = this.spiderEngine.nodes.get(vPath)
				if (node) {
					if (node.hazardScore > 0.5) penalty *= 1 + node.hazardScore
					if (node.blastRadius > 0.7) penalty *= 1.2
					if (node.isHotspot) penalty *= 1.1
				}
				localPenalty += penalty * weight * scaleFactor
			} else {
				globalPenalty += penalty * weight * scaleFactor
			}
		}

		// V250: Global Amnesty Cap
		// When focused on a file, we cap the penalty from unrelated parts of the project to 5 points.
		// This prevents distant lint errors from blocking progress on a healthy module.
		const effectiveGlobalPenalty = focusPath ? Math.min(5, globalPenalty) : globalPenalty
		let totalPenalty = localPenalty + effectiveGlobalPenalty

		// V250: High-Velocity Amnesty
		// If the project is verifiably recovering, cut penalties in half to encourage completion.
		if (this.spiderEngine.isRecovering) {
			totalPenalty *= 0.5
		}

		const base = 100
		// High Velocity Buffer: Minor issues should not block progress
		const finalPenalty = totalPenalty < 2.0 ? totalPenalty * 0.3 : totalPenalty
		const score = Math.max(5, Math.round(base - Math.min(95, finalPenalty)))

		this.lastBuildHealth = score
		return score
	}

	/**
	 * V230: Calculates shortest path distance in the dependency graph using BFS.
	 * Uses resolved Node IDs from consumptions (outgoing) and dependents (incoming).
	 */
	private calculateGraphDistances(startPath: string, distanceMap: Map<string, number>): void {
		const queue: [string, number][] = [[startPath, 0]]
		distanceMap.set(startPath, 0)
		const visited = new Set<string>([startPath])

		let iterations = 0
		const MAX_ITERATIONS = 1000 // Industrial Breadth

		while (queue.length > 0 && iterations < MAX_ITERATIONS) {
			const [current, dist] = queue.shift()!
			iterations++

			if (dist >= 3) continue // Only care about local neighborhood

			const node = this.spiderEngine.nodes.get(current)
			if (!node) continue

			// V230: High-Precision Neighbor Detection
			// 1. Outgoing dependencies (files this node imports)
			const outgoing = Object.keys(node.consumptions || {})
			// 2. Incoming dependencies (files that import this node)
			const incoming = node.dependents || []

			const neighbors = new Set([...outgoing, ...incoming])

			for (const neighborId of neighbors) {
				if (!visited.has(neighborId)) {
					visited.add(neighborId)
					distanceMap.set(neighborId, dist + 1)
					queue.push([neighborId, dist + 1])
				}
			}
		}
	}

	/**
	 * Returns the current stability and investigation status for a file.
	 */
	public getStabilityTelemetry(filePath: string, layer: string, tokens = 0) {
		const absPath = path.resolve(this.cwd, filePath)
		const normPath = this.spiderEngine.normalizePath(absPath)
		const currentViolations = this.spiderEngine.getViolations()

		return {
			pressure: this.stabilityMonitor.getPressure(normPath),
			resonance: this.stabilityMonitor.getVelocityDamping(),
			health: this.computeBuildHealth(currentViolations, normPath),
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
		const stats = this.stabilityMonitor.getStabilityStats()

		return {
			timestamp: Date.now(),
			health: this.computeBuildHealth(violations),
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
		this.stabilityMonitor.resetStabilityPressure(true) // V189: Transient reset
		this.lastBuildHealth = 100
		Logger.info("[StabilityTelemetrics] Unified Project Pressure Reset (Transient).")
	}

	/**
	 * Returns the resilience shield summary.
	 */
	public getResilienceShield(): string {
		const metabolic = this.stabilityMonitor.getStabilityStats()
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

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		Logger.info("[StabilityTelemetrics] Telemetrics substrate released.")
	}
}
