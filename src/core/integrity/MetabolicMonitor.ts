import * as crypto from "crypto"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { SafeNumber } from "../../shared/utils/SafeNumber"

export interface MetabolicMetrics {
	reads: number
	writes: number
	linesAdded: number
	linesDeleted: number
	lastEditTimestamp: number
	lastReadTimestamp: number
	lastObservedHash?: string // V30 Merkle Drift Detection
	lastAestheticHash?: string // V100: Structural integrity hash
	lastTurnId?: string // V100: Synthesis tracking
	symbolObservations: Set<string> // V26: Neural Forensic Tracking
	aestheticWrites: number // V188: Noise filtering count
}

/**
 * Serializable version of metrics for persistence.
 */
export interface SerializableMetabolicMetrics extends Omit<MetabolicMetrics, "symbolObservations"> {
	symbolObservations: string[]
}

export interface StabilityStats {
	totalReads: number
	totalWrites: number
	avgPressure: number
	avgDoubtSignal: number
	hotspots: { path: string; stress: number }[]
	aestheticResilience: number
}

/**
 * MetabolicMonitor: Tracks the "Stability" and "Activity Level" of the project.
 * Implements activity detection: Churn, High Activity, and Doubt.
 */
export class MetabolicMonitor {
	private registry: Map<string, MetabolicMetrics> = new Map()
	private cooldownThreshold = 25 // Base collective edits per 30 minutes
	private refactorThreshold = 50 // V33: Ethereal budget for refactors
	private thresholdMultiplier = 1.0 // V80: Adaptive Metabolism
	private resonanceMultiplier = 1.0 // V100: Cognitive Resonance
	private sessionVersion = 1 // V150: State Evolution

	/**
	 * Records a read operation.
	 */
	public recordRead(filePath: string, content?: string) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.reads++
		metrics.lastReadTimestamp = Date.now()

		if (content) {
			metrics.lastObservedHash = this.computeHash(content)
		}
	}

	/**
	 * Records a write/edit operation.
	 * V100: Metabolic Synthesis & Aesthetic Agility.
	 */
	public recordWrite(filePath: string, content?: string, added = 0, deleted = 0, turnId?: string) {
		const metrics = this.getOrCreateMetrics(filePath)

		let impactMultiplier = this.resonanceMultiplier

		if (content) {
			const aesHash = this.computeAestheticHash(content)
			if (metrics.lastAestheticHash === aesHash) {
				impactMultiplier *= 0.1 // V100: Aesthetic changes have minimal impact
				metrics.aestheticWrites++
				Logger.info(`[StabilityMonitor] Visual Alignment: Minimal structural change in ${path.basename(filePath)}`)
			} else if (turnId && metrics.lastTurnId === turnId) {
				impactMultiplier *= 0.5 // V100: Activity Consolidation: iterative edits in same turn discounted
				Logger.info(`[StabilityMonitor] Activity Consolidation: Repeated session update for ${path.basename(filePath)}`)
			}
			metrics.lastAestheticHash = aesHash
		}

		metrics.writes += 1 * impactMultiplier
		metrics.linesAdded += added * impactMultiplier
		metrics.linesDeleted += deleted * impactMultiplier
		metrics.lastEditTimestamp = Date.now()
		metrics.lastTurnId = turnId

		if (content) {
			metrics.lastObservedHash = this.computeHash(content)
		}
	}

	/**
	 * Computes a structural hash for the given content.
	 */
	private computeHash(content: string): string {
		return crypto.createHash("md5").update(content).digest("hex")
	}

	/**
	 * V100: Computes a hash after stripping comments and whitespace.
	 * Enables Aesthetic Agility (ignoring formatting churn).
	 */
	private computeAestheticHash(content: string): string {
		const normalized = content
			.replace(/\/\/.*$/gm, "") // Remove single-line comments
			.replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
			.replace(/\s+/g, "") // Remove all whitespace
		return crypto.createHash("md5").update(normalized).digest("hex")
	}

	public getDoubtSignal(filePath: string, layer = "infrastructure", lineCount = 0): number {
		const metrics = this.registry.get(filePath)
		if (!metrics) return 0
		const baseDoubt = metrics.reads / (metrics.writes || 1)

		// PRODUCTION HARDENING: Layer-Aware Throttling.
		// Domain/Core have a much lower "Doubt budget".
		const threshold = layer === "domain" || layer === "core" ? 5.0 : 15.0

		if (metrics.reads > threshold && metrics.writes === 0) return 999.0 // Hard stall signal

		// Lenience factor for large files (> 500 lines)
		const lenience = lineCount > 500 ? Math.min(2.0, lineCount / 500) : 1.0
		return baseDoubt / lenience
	}

	/**
	 * PRODUCTION HARDENING: Detects if the agent is stuck in a high-entropy recursive scanning loop.
	 */
	public detectRecursiveLoop(): { loop: boolean; files?: string[] } {
		const loopingFiles = Array.from(this.registry.entries())
			.filter(([_p, m]) => m.lastEditTimestamp === 0 && m.reads > 5) // Read multiple times but never edited
			.map(([p]) => p)

		if (loopingFiles.length >= 3) {
			return {
				loop: true,
				files: loopingFiles,
			}
		}
		return { loop: false }
	}

	/**
	 * Detects if a file has high activity (High churn in a short period).
	 * V189: Calibrated with nodal scale factor.
	 */
	public isHighlyActive(filePath: string, isRefactoring = false, lineCount = 0): { active: boolean; reason?: string } {
		const metrics = this.registry.get(filePath)
		if (!metrics) return { active: false }

		const pressure = this.getPressure(filePath)
		const sizeFactor = lineCount > 0 ? Math.log10(Math.max(10, lineCount)) : 1.0
		const threshold = (isRefactoring ? 15.0 : 7.0) * sizeFactor

		if (pressure > threshold) {
			return {
				active: true,
				reason: `Activity level (${SafeNumber.format(pressure, 1)}) exceeded stability limit.`,
			}
		}

		return { active: false }
	}

	/**
	 * PRODUCTION HARDENING: Normalized pressure score [0.0 - 10.0+] for a file.
	 * V189: Calibrated with Doubt Signal weighting to detect "Investigative Thrashing".
	 */
	public getPressure(filePath: string): number {
		const metrics = this.registry.get(filePath)
		if (!metrics) return 0

		const churn = metrics.writes + (metrics.linesAdded + metrics.linesDeleted) / 100
		const doubt = this.getDoubtSignal(filePath)

		// If high doubt (> 10), it acts as a pressure multiplier
		const doubtMultiplier = doubt > 10 ? Math.min(2.0, 1.0 + (doubt - 10) / 20) : 1.0

		return churn * this.resonanceMultiplier * doubtMultiplier
	}

	/**
	 * Detects "Task Drift" — changing too many unrelated files in a short burst.
	 * Calibrated for high-velocity agents: Planning mode is 2x more lenient to allow for broad exploration.
	 */
	public getTaskDrift(
		isPlanning = false,
		isRefactoring = false,
		scratchpadContent = "",
	): { drift: number; warning?: string; isInfraTurn?: boolean } {
		const recentThreshold = Date.now() - 600000 // 10 minutes
		const recentEntries = Array.from(this.registry.entries()).filter(([_p, m]) => m.lastEditTimestamp > recentThreshold)

		const drift = recentEntries.length
		// PRODUCTION HARDENING: "Refactor Mode" allows for 50% more drift to support complex cross-module changes.
		const baseThreshold = (isPlanning ? 20 : 10) * this.thresholdMultiplier
		const threshold = isRefactoring ? Math.floor(baseThreshold * 1.5) : baseThreshold

		// V8: Infrastructure Turn Suppression
		const isInfraTurn = scratchpadContent.includes("# INFRASTRUCTURE TURN") || scratchpadContent.includes("# TECH DEBT TURN")

		if (drift > threshold && !isInfraTurn) {
			return {
				drift,
				warning: `⚠️ [SPI-202] TASK DRIFT DETECTED: You have modified ${drift} different files in 10m. Focus on one module at a time.`,
			}
		}

		// v9 HARDENING: Mission Drift Detection (Yak Shaving Protection)
		if (drift >= 5 && !isPlanning && !isInfraTurn) {
			const nonDomainEdits = recentEntries.filter(([p]) => !p.includes("/domain/") && !p.includes("/core/")).length
			const missionRatio = nonDomainEdits / drift

			if (missionRatio >= 0.9) {
				return {
					drift,
					warning: `🛑 [SPI-203] MISSION DRIFT: 90% of updates are in peripheral files. Return focus to Domain/Core logic.`,
				}
			}
		}

		// V16: Breather Support
		if (scratchpadContent.includes("# SOVEREIGN_BREATHER") || scratchpadContent.includes("# STABILITY BREAK")) {
			this.resetMetabolicPressure(true) // V189: Transient reset only
			return { drift: 0, isInfraTurn: true }
		}

		return { drift, isInfraTurn }
	}

	/**
	 * V8: Resets activity history for a specific file (Stability break recovery)
	 */
	public resetFileInflammation(filePath: string) {
		const metrics = this.registry.get(filePath)
		if (metrics) {
			metrics.linesAdded = 0
			metrics.linesDeleted = 0
			metrics.writes = 0
			Logger.info(`[StabilityMonitor] Activity history cleared for ${path.basename(filePath)}`)
		}
	}

	/**
	 * Gets the project-wide stability stats.
	 */
	public getStabilityStats(): StabilityStats {
		let totalReads = 0
		let totalWrites = 0
		const hotspots: { path: string; stress: number }[] = []

		for (const [p, m] of this.registry.entries()) {
			totalReads += m.reads
			totalWrites += m.writes
			const stress = this.getPressure(p)
			if (stress > 1) {
				hotspots.push({ path: p, stress })
			}
		}

		return {
			totalReads,
			totalWrites,
			avgPressure:
				Array.from(this.registry.keys()).reduce((acc, p) => acc + this.getPressure(p), 0) / (this.registry.size || 1),
			avgDoubtSignal: totalReads / (totalWrites || 1),
			hotspots: hotspots.sort((a, b) => b.stress - a.stress).slice(0, 5),
			aestheticResilience: this.getAestheticStatus(),
		}
	}

	/**
	 * V188: Computes the efficiency of the substrate in filtering aesthetic noise.
	 */
	public getAestheticStatus(): number {
		let total = 0
		let aesthetic = 0
		for (const m of this.registry.values()) {
			total += m.writes || 0
			aesthetic += m.aestheticWrites || 0
		}
		return total === 0 ? 1.0 : aesthetic / total
	}

	/**
	 * V26: Records a focused observation of a specific symbol (class/function).
	 */
	public recordSymbolObservation(filePath: string, symbol: string) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.symbolObservations.add(symbol)
		Logger.info(`[StabilityMonitor] Focus recorded: ${symbol} in ${path.basename(filePath)}`)
	}

	/**
	 * V26: Returns a read-only snapshot of the investigation registry.
	 */
	public getForensicRegistry(): ReadonlyMap<string, MetabolicMetrics> {
		return this.registry
	}

	private getOrCreateMetrics(filePath: string): MetabolicMetrics {
		let metrics = this.registry.get(filePath)
		if (!metrics) {
			metrics = {
				reads: 0,
				writes: 0,
				linesAdded: 0,
				linesDeleted: 0,
				lastEditTimestamp: 0,
				lastReadTimestamp: Date.now(),
				symbolObservations: new Set<string>(),
				aestheticWrites: 0,
			}
			this.registry.set(filePath, metrics)
		}
		return metrics
	}

	/**
	 * PRODUCTION HARDENING: Identifies "Stagnant Substrate" — files with high age-to-utility ratios.
	 */
	public getStagnantSubstrate(): { path: string; ageInDays: number; utility: number }[] {
		const now = Date.now()
		const stagnant: { path: string; ageInDays: number; utility: number }[] = []

		for (const [p, m] of this.registry.entries()) {
			const ageInMs = now - Math.max(m.lastEditTimestamp, m.lastReadTimestamp)
			const ageInDays = ageInMs / (1000 * 60 * 60 * 24)
			const utility = m.reads + m.writes * 5

			// If unvisited for > 15 days despite project churn
			if (ageInDays > 15 && utility < 10) {
				stagnant.push({ path: p, ageInDays, utility })
			}
		}

		return stagnant.sort((a, b) => b.ageInDays - a.ageInDays)
	}

	/**
	 * PRODUCTION HARDENING: Evaluates the project-wide cognitive load and triggers a COOLDOWN
	 * if the metabolic churn exceeds the safety capacity of the substrate.
	 */
	public getCooldownStatus(isRefactoring = false): { active: boolean; reason?: string } {
		const recentThreshold = Date.now() - 1800000 // 30 minutes
		const totalRecentWrites = Array.from(this.registry.values()).reduce((acc, m) => {
			return m.lastEditTimestamp > recentThreshold ? acc + m.writes : acc
		}, 0)

		const threshold = (isRefactoring ? this.refactorThreshold : this.cooldownThreshold) * this.thresholdMultiplier

		if (totalRecentWrites > threshold) {
			return {
				active: true,
				reason: `System-wide activity peaking (${totalRecentWrites} edits in 30m). ${isRefactoring ? "(Refactor mode: Extra budget applied)" : "Stability safety threshold reached."}`,
			}
		}

		return { active: false }
	}

	/**
	 * PRODUCTION HARDENING: Emergency override to reset project activity.
	 * V189: Forensic Separation - Clear pressure without destroying historical logs.
	 */
	public resetMetabolicPressure(onlyTransient = false) {
		if (onlyTransient) {
			for (const m of this.registry.values()) {
				m.writes = 0
				m.linesAdded = 0
				m.linesDeleted = 0
				m.aestheticWrites = 0
			}
		} else {
			this.registry.clear()
		}
		this.thresholdMultiplier = 1.0 // Reset velocity to base
		Logger.info(`🔋 [StabilityMonitor] Activity level reset (${onlyTransient ? "Transient" : "Full"}).`)
	}

	/**
	 * V80: Adjusts the metabolic agility of the substrate.
	 */
	public setThresholdMultiplier(multiplier: number) {
		this.thresholdMultiplier = multiplier
	}

	/**
	 * V100: Sets the cognitive resonance factor (Damping).
	 */
	public setResonance(multiplier: number) {
		this.resonanceMultiplier = multiplier
	}
	/**
	 * V150: Cognitive Immortality.
	 */
	public exportState(): MetabolicState {
		const registryObj: Record<string, SerializableMetabolicMetrics> = {}
		for (const [p, m] of this.registry.entries()) {
			registryObj[p] = {
				...m,
				symbolObservations: Array.from(m.symbolObservations),
			}
		}

		return {
			version: this.sessionVersion,
			registry: registryObj,
			thresholdMultiplier: this.thresholdMultiplier,
			resonanceMultiplier: this.resonanceMultiplier,
			timestamp: Date.now(),
		}
	}

	/**
	 * V150: Substrate Restoration.
	 */
	public importState(state: MetabolicState) {
		if (!state || state.version !== this.sessionVersion) {
			Logger.warn("[MetabolicMonitor] Incompatible state version. Resetting memory.")
			this.resetMetabolicPressure()
			return
		}

		this.thresholdMultiplier = state.thresholdMultiplier
		this.resonanceMultiplier = state.resonanceMultiplier

		for (const [p, m] of Object.entries(state.registry)) {
			this.registry.set(p, {
				...m,
				symbolObservations: new Set(m.symbolObservations),
			})
		}
		Logger.info(`[StabilityMonitor] Project Restored: ${this.registry.size} files restored to context registry.`)
	}

	public getResonance(): number {
		return this.resonanceMultiplier
	}
}

/**
 * V150: Industrial Maturity.
 * Helper for deep state serialization.
 */
export interface MetabolicState {
	version: number
	registry: Record<string, SerializableMetabolicMetrics>
	thresholdMultiplier: number
	resonanceMultiplier: number
	timestamp: number
}
