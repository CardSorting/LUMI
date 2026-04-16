import * as crypto from "crypto"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface MetabolicMetrics {
	reads: number
	writes: number
	linesAdded: number
	linesDeleted: number
	lastEditTimestamp: number
	lastReadTimestamp: number
	lastObservedHash?: string // V30 Merkle Drift Detection
	symbolObservations: Set<string> // V26: Neural Forensic Tracking
}

/**
 * MetabolicMonitor: Tracks the "Vitality" and "Stress" of the project.
 * Implements organismal detection: Churn, Fever, and Doubt.
 */
export class MetabolicMonitor {
	private registry: Map<string, MetabolicMetrics> = new Map()
	private cooldownThreshold = 25 // Base collective edits per 30 minutes
	private refactorThreshold = 50 // V33: Ethereal budget for refactors
	private thresholdMultiplier = 1.0 // V80: Adaptive Metabolism

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
	 * V31: Structural Sync Awareness. Updates the last observed hash immediately.
	 */
	public recordWrite(filePath: string, content?: string, added = 0, deleted = 0) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.writes++
		metrics.linesAdded += added
		metrics.linesDeleted += deleted
		metrics.lastEditTimestamp = Date.now()

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
	 * Detects if a file is "Inflamed" (High churn in a short period).
	 */
	public isMetabolicallyInflamed(filePath: string, isRefactoring = false): { inflamed: boolean; reason?: string } {
		const metrics = this.registry.get(filePath)
		if (!metrics) return { inflamed: false }

		const timeSinceLastEdit = Date.now() - metrics.lastEditTimestamp
		const totalDelta = metrics.linesAdded + metrics.linesDeleted

		// V33: Ethereal Leniency
		const churnThreshold = (isRefactoring ? 1000 : 500) * this.thresholdMultiplier
		const writeThreshold = (isRefactoring ? 10 : 5) * this.thresholdMultiplier

		const highChurn = totalDelta > churnThreshold
		const recentActivity = timeSinceLastEdit < 3600000 // 1 hour

		if (highChurn && recentActivity && metrics.writes > writeThreshold) {
			return {
				inflamed: true,
				reason: `High metabolic churn detected (${metrics.writes} edits). ${isRefactoring ? "(Refactor leniency applied)" : ""}`,
			}
		}

		return { inflamed: false }
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
				warning: `⚠️ TASK DRIFT DETECTED: You have modified ${drift} different files in the last 10 minutes. This high-entropy behavior increases the risk of regression. Focus on one module at a time.${isRefactoring ? " (Refactor leniency applied)" : ""}`,
			}
		}

		// v9 HARDENING: Mission Drift Detection (Yak Shaving Protection)
		// Track if we are spending too much metabolic energy in non-core layers
		if (drift >= 5 && !isPlanning && !isInfraTurn) {
			const nonDomainEdits = recentEntries.filter(([p]) => !p.includes("/domain/") && !p.includes("/core/")).length
			const missionRatio = nonDomainEdits / drift

			// PRODUCTION HARDENING: Interdict at 90% drift
			if (missionRatio >= 0.9) {
				return {
					drift,
					warning: `🛑 MISSION DRIFT [CRITICAL]: 90% of your recent edits are in peripheral layers (Plumbing/Infrastructure). Architectural investigations suggest you are "Yak Shaving". You MUST return focus to Domain/Core logic immediately or trigger a # SOVEREIGN AUDIT to justify this detour.`,
				}
			}

			if (missionRatio > 0.7) {
				return {
					drift,
					warning: `⚠️ MISSION DRIFT [Urgency: MEDIUM]: ${Math.round(missionRatio * 100)}% of your recent edits are in peripheral layers. Ensure you are not drifting from the primary objective.`,
				}
			}
		}

		// V16: Breather Support
		if (scratchpadContent.includes("# SOVEREIGN_BREATHER")) {
			this.resetMetabolicPressure()
			return { drift: 0, isInfraTurn: true }
		}

		// V16: Agile Drift Tuning
		if (scratchpadContent.includes("# SOVEREIGN_AGILE")) {
			const agileThreshold = 25
			if (drift > agileThreshold) {
				return {
					drift,
					warning: `⚠️ AGILE DRIFT ALERT: Even in Agile mode, ${drift} files is a high blast radius. Consider a checkpoint soon.`,
				}
			}
			return { drift, isInfraTurn: true }
		}

		return { drift, isInfraTurn }
	}

	/**
	 * V8: Resets inflammation for a specific file (Breath-based recovery)
	 */
	public resetFileInflammation(filePath: string) {
		const metrics = this.registry.get(filePath)
		if (metrics) {
			metrics.linesAdded = 0
			metrics.linesDeleted = 0
			metrics.writes = 0
			Logger.info(`[MetabolicMonitor] Inflammation manually cleared for ${path.basename(filePath)}`)
		}
	}

	/**
	 * Gets the project-wide vitality stats.
	 */
	public getVitalityStats() {
		let totalReads = 0
		let totalWrites = 0
		const hotspots: { path: string; stress: number }[] = []

		for (const [p, m] of this.registry.entries()) {
			totalReads += m.reads
			totalWrites += m.writes
			const stress = m.reads * 0.2 + m.writes * 0.8 + (m.linesAdded + m.linesDeleted) / 100
			if (stress > 1) {
				hotspots.push({ path: p, stress })
			}
		}

		return {
			totalReads,
			totalWrites,
			avgDoubtSignal: totalReads / (totalWrites || 1),
			hotspots: hotspots.sort((a, b) => b.stress - a.stress).slice(0, 5),
		}
	}

	/**
	 * V26: Records a focused observation of a specific symbol (class/function).
	 */
	public recordSymbolObservation(filePath: string, symbol: string) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.symbolObservations.add(symbol)
		Logger.info(`[MetabolicMonitor] Symbol observed: ${symbol} in ${path.basename(filePath)}`)
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
				reason: `System-wide metabolic churn peaking (${totalRecentWrites} edits in 30m). ${isRefactoring ? "(Refactor status active: Budget doubled)" : "Substrate heat threshold exceeded."}`,
			}
		}

		return { active: false }
	}

	/**
	 * PRODUCTION HARDENING: Emergency override to reset metabolic pressure.
	 * Allows for manual recovery from audit locks during project-wide infrastructure turns.
	 */
	public resetMetabolicPressure() {
		this.registry.clear()
		this.thresholdMultiplier = 1.0 // Reset velocity to base
		Logger.info("🔋 [MetabolicMonitor] Metabolic pressure reset. Inflammation cleared.")
	}

	/**
	 * V80: Adjusts the metabolic agility of the substrate.
	 */
	public setThresholdMultiplier(multiplier: number) {
		this.thresholdMultiplier = multiplier
	}
}
