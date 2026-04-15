export interface MetabolicMetrics {
	reads: number
	writes: number
	linesAdded: number
	linesDeleted: number
	lastEditTimestamp: number
}

/**
 * MetabolicMonitor: Tracks the "Vitality" and "Stress" of the project.
 * Implements organismal detection: Churn, Fever, and Doubt.
 */
export class MetabolicMonitor {
	private registry: Map<string, MetabolicMetrics> = new Map()

	constructor(_cwd: string) {}

	/**
	 * Records a read operation.
	 */
	public recordRead(filePath: string) {
		const metrics = this.getOrCreateMetrics(filePath)
		metrics.reads++
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

	/**
	 * Calculates the "Doubt Signal" (Read:Write ratio) for a file.
	 * Calibrated for large files to allow more reads during deep research.
	 */
	public getDoubtSignal(filePath: string, lineCount = 0): number {
		const metrics = this.registry.get(filePath)
		if (!metrics) return 0
		const baseDoubt = metrics.reads / (metrics.writes || 1)
		// Lenience factor for large files (> 500 lines)
		const lenience = lineCount > 500 ? Math.min(2.0, lineCount / 500) : 1.0
		return baseDoubt / lenience
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

		// v9 HARDENING: Mission Drift Detection
		// Track if we are spending too much metabolic energy in non-core layers
		if (drift >= 5 && !isPlanning) {
			const nonDomainEdits = recentEntries.filter(([p]) => !p.includes("/domain/") && !p.includes("/core/")).length
			const missionRatio = nonDomainEdits / drift
			if (missionRatio > 0.8) {
				return {
					drift,
					warning: `⚠️ MISSION DRIFT [Urgency: MEDIUM]: 80% of your recent edits are in peripheral layers (Plumbing/Infrastructure). Ensure you are not "Yak Shaving"—return focus to the core Domain requirements.`,
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
			metrics = { reads: 0, writes: 0, linesAdded: 0, linesDeleted: 0, lastEditTimestamp: 0 }
			this.registry.set(filePath, metrics)
		}
		return metrics
	}
}
