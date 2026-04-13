import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { SpiderEngine } from "../policy/SpiderEngine.js"
import { AuditRecorder } from "./AuditRecorder.js"

export interface SovereignHandoverData {
	projectId: string
	timestamp: string
	lastIntegrityScore: number
	violations: string[]
	graphState: string // Serialized SpiderEngine
}

/**
 * SovereigntyHandover: Ensures architectural continuity across agent sessions.
 * Exports a "Sovereignty Snapshot" that can be ingested by any future agent
 * to immediately inherit the project's architectural discipline.
 */
export class SovereigntyHandover {
	private handoverPath: string

	constructor(private cwd: string) {
		this.handoverPath = path.join(cwd, "SOVEREIGNTY_JSON")
	}

	/**
	 * Exports the full architectural state.
	 */
	public async exportSovereignty(engine: SpiderEngine, recorder: AuditRecorder) {
		const report = engine.computeEntropy()
		const score = Math.round((1 - report.score) * 100)
		const violations = engine.getViolations().map((v) => v.message)

		const data: SovereignHandoverData = {
			projectId: path.basename(this.cwd),
			timestamp: new Date().toISOString(),
			lastIntegrityScore: score,
			violations,
			graphState: engine.serialize().toString("base64"),
		}

		try {
			await fs.promises.writeFile(this.handoverPath, JSON.stringify(data, null, 2), "utf-8")
			Logger.info(`[SovereigntyHandover] Architectural state exported to ${this.handoverPath}`)
		} catch (error) {
			Logger.error("[SovereigntyHandover] Export failed:", error)
		}
	}

	/**
	 * Imports sovereignty data to restore a previous engine state.
	 */
	public async importSovereignty(engine: SpiderEngine): Promise<boolean> {
		if (!fs.existsSync(this.handoverPath)) return false

		try {
			const content = await fs.promises.readFile(this.handoverPath, "utf-8")
			const data: SovereignHandoverData = JSON.parse(content)
			engine.deserialize(Buffer.from(data.graphState, "base64"))
			Logger.info(
				`[SovereigntyHandover] Architectural sovereignty restored from ${data.timestamp} (Score: ${data.lastIntegrityScore})`,
			)
			return true
		} catch (error) {
			Logger.error("[SovereigntyHandover] Import failed:", error)
			return false
		}
	}
}
