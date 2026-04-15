import { Logger } from "@/shared/services/Logger"

export interface MetabolicMetrics {
	reads: number
	writes: number
	linesAdded: number
	linesDeleted: number
	lastEditTimestamp: number
	lastReadTimestamp: number
}

/**
 * MetabolicMonitor: Tracks the "Vitality" and "Stress" of the project.
 * Implements organismal detection: Churn, Fever, and Doubt.
 */
export class MetabolicMonitor {
	private registry: Map<string, MetabolicMetrics> = new Map()
	private cooldownThreshold = 15 // Max collective edits per 3 turns

	/**
	 * Records a read operation.
	 */
	public recordRead(filePath: string) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.reads++
		metrics.lastReadTimestamp = Date.now()
	}

	/**
	 * Records a write/edit operation.
	 */
	public recordWrite(filePath: string, added = 0, deleted = 0) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.writes++
		metrics.linesAdded += added
		metrics.linesDeleted += deleted
		metrics.lastEditTimestamp = Date.now()
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
	public isInflamed(filePath: string): { inflamed: boolean; reason?: string } {
		const metrics = this.registry.get(filePath)
		if (!metrics) return { inflamed: false }

		const timeSinceLastEdit = Date.now() - metrics.lastEditTimestamp
		const highChurn = metrics.linesAdded + metrics.linesDeleted > 500
		const recentActivity = timeSinceLastEdit < 3600000 // 1 hour

		if (highChurn && recentActivity && metrics.writes > 5) {
			return {
				inflamed: true,
				reason: `High metabolic churn detected (${metrics.writes} edits, ${metrics.linesAdded + metrics.linesDeleted} lines modified in under an hour).`,
			}
		}

		return { inflamed: false }
	}

	/**
	 * Detects "Task Drift" — changing too many unrelated files in a short burst.
	 * Calibrated for high-velocity agents: Planning mode is 2x more lenient to allow for broad exploration.
	 */
	public getTaskDrift(isPlanning = false, isRefactoring = false): { drift: number; warning?: string } {
		const recentThreshold = Date.now() - 600000 // 10 minutes
		const recentEntries = Array.from(this.registry.entries()).filter(([_p, m]) => m.lastEditTimestamp > recentThreshold)

		const drift = recentEntries.length
		// PRODUCTION HARDENING: "Refactor Mode" allows for 50% more drift to support complex cross-module changes.
		const baseThreshold = isPlanning ? 20 : 10
		const threshold = isRefactoring ? Math.floor(baseThreshold * 1.5) : baseThreshold

		if (drift > threshold) {
			return {
				drift,
				warning: `⚠️ TASK DRIFT DETECTED: You have modified ${drift} different files in the last 10 minutes. This high-entropy behavior increases the risk of regression. Focus on one module at a time.${isRefactoring ? " (Refactor leniency applied)" : ""}`,
			}
		}

		// v9 HARDENING: Mission Drift Detection (Yak Shaving Protection)
		// Track if we are spending too much metabolic energy in non-core layers
		if (drift >= 5 && !isPlanning) {
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

		return { drift }
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
	public getCooldownStatus(): { active: boolean; reason?: string } {
		const recentThreshold = Date.now() - 1800000 // 30 minutes
		const totalRecentWrites = Array.from(this.registry.values()).reduce((acc, m) => {
			return m.lastEditTimestamp > recentThreshold ? acc + m.writes : acc
		}, 0)

		if (totalRecentWrites > this.cooldownThreshold) {
			return {
				active: true,
				reason: `System-wide metabolic churn peaking (${totalRecentWrites} edits in 30m). Substrate heat threshold exceeded.`,
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
		Logger.info("🔋 [MetabolicMonitor] Metabolic pressure reset. Inflammation cleared.")
	}
}
