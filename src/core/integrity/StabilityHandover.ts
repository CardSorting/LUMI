import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { SpiderEngine } from "../policy/spider/SpiderEngine.js"
import { AuditRecorder } from "./AuditRecorder.js"

export interface StabilityHandoverData {
	projectId: string
	timestamp: string
	lastBuildHealth: number
	violations: string[]
	graphState: string // Serialized SpiderEngine
}

/**
 * StabilityHandover: Ensures architectural continuity across agent sessions.
 * Exports a "Stability Snapshot" that can be ingested by any future agent
 * to immediately inherit the project's architectural discipline.
 */
export class StabilityHandover {
	private handoverPath: string

	constructor(private cwd: string) {
		this.handoverPath = path.join(cwd, "STABILITY_HANDOVER.json")
	}

	/**
	 * Exports the full architectural state.
	 */
	public async exportStability(engine: SpiderEngine, recorder: AuditRecorder) {
		const report = engine.computeEntropy()
		const score = Math.round((1 - report.score) * 100)
		const violations = engine.getViolations().map((v) => v.message)

		const data: StabilityHandoverData = {
			projectId: path.basename(this.cwd),
			timestamp: new Date().toISOString(),
			lastBuildHealth: score,
			violations,
			graphState: engine.serialize().toString("base64"),
		}

		try {
			await fs.promises.writeFile(this.handoverPath, JSON.stringify(data, null, 2), "utf-8")
			Logger.info(`[StabilityHandover] Architectural state exported to ${this.handoverPath}`)
		} catch (error) {
			Logger.error("[StabilityHandover] Export failed:", error)
		}
	}

	/**
	 * Imports stability data to restore a previous engine state.
	 */
	public async importStability(engine: SpiderEngine): Promise<boolean> {
		if (!fs.existsSync(this.handoverPath)) return false

		try {
			const content = await fs.promises.readFile(this.handoverPath, "utf-8")
			const data: StabilityHandoverData = JSON.parse(content)
			engine.deserialize(Buffer.from(data.graphState, "base64"))
			Logger.info(
				`[StabilityHandover] Architectural stability restored from ${data.timestamp} (Build Health: ${data.lastBuildHealth})`,
			)
			return true
		} catch (error) {
			Logger.error("[StabilityHandover] Import failed:", error)
			return false
		}
	}
}
