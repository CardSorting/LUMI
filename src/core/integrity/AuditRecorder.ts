import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface AuditRecord {
	timestamp: number
	score: number
	violationCount: number
	fileCount: number
}

/**
 * AuditRecorder: Maintains a persistent record of architectural health.
 * This enables trend analysis and long-term sovereignty monitoring.
 */
export class AuditRecorder {
	private auditFilePath: string
	private maxRecords = 100

	constructor(cwd: string) {
		// Store audit history in the .spider directory to keep it associated with node telemetry
		this.auditFilePath = path.join(cwd, ".spider", "joy_audit.json")
	}

	/**
	 * Persists a new integrity snapshot to the audit history.
	 */
	public async record(score: number, violationCount: number, fileCount: number): Promise<void> {
		try {
			const history = await this.getHistory()
			const record: AuditRecord = {
				timestamp: Date.now(),
				score,
				violationCount,
				fileCount,
			}

			history.push(record)

			// Keep history manageable
			if (history.length > this.maxRecords) {
				history.shift()
			}

			const dir = path.dirname(this.auditFilePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}

			await fs.promises.writeFile(this.auditFilePath, JSON.stringify(history, null, 2))
		} catch (error) {
			Logger.error("[AuditRecorder] Failed to record audit:", error)
		}
	}

	/**
	 * Retrieves the full audit history.
	 */
	public async getHistory(): Promise<AuditRecord[]> {
		try {
			if (!fs.existsSync(this.auditFilePath)) {
				return []
			}
			const data = await fs.promises.readFile(this.auditFilePath, "utf-8")
			return JSON.parse(data)
		} catch (error) {
			Logger.error("[AuditRecorder] Failed to read audit history:", error)
			return []
		}
	}

	/**
	 * Computes architectural trends.
	 */
	public async getTrend(): Promise<{ change: number; message: string }> {
		const history = await this.getHistory()
		if (history.length < 2) {
			return { change: 0, message: "Awaiting baseline..." }
		}

		const latest = history[history.length - 1]
		const previous = history[history.length - 2]
		
		if (!latest || !previous) return { change: 0, message: "Stable" }

		const change = latest.score - previous.score
		let message = "Stable"
		
		if (change > 5) message = "AESTHETIC ASCENT (Integrity improved significantly)"
		else if (change > 0) message = "Incremental progress"
		else if (change < -5) message = "ARCHITECTURAL DECAY (Critical regression detected)"
		else if (change < 0) message = "Minor structural drift"

		return { change, message }
	}
}
