import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface TransactionStep {
	path: string
	originalContent: string | null
	newContent: string | null
	type: "WRITE" | "DELETE"
}

/**
 * SovereignTransaction: Ensures structural ACID properties for complex repairs.
 * If a multi-file heal fails verification, the transaction rolls back.
 */
export class SovereignTransaction {
	private steps: TransactionStep[] = []
	private isActive = false
	private journalPath: string

	constructor(
		private id: string,
		private cwd: string,
	) {
		this.journalPath = path.join(this.cwd, ".spider", "tx_journal.json")
	}

	public start() {
		this.steps = []
		this.isActive = true
	}

	public stage(path: string, type: "WRITE" | "DELETE", newContent: string | null = null) {
		if (!this.isActive) throw new Error("No active transaction")

		const exists = fs.existsSync(path)
		this.steps.push({
			path,
			type,
			originalContent: exists ? fs.readFileSync(path, "utf-8") : null,
			newContent,
		})
		// PRODUCTION HARDENING: Persistent Journaling
		this.writeJournal()
	}

	private writeJournal() {
		const dir = path.dirname(this.journalPath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(this.journalPath, JSON.stringify({ id: this.id, steps: this.steps }, null, 2))
	}

	private clearJournal() {
		if (fs.existsSync(this.journalPath)) fs.unlinkSync(this.journalPath)
	}

	/**
	 * PRODUCTION HARDENING: Recovers from a half-committed transaction after a crash.
	 */
	public static recover(cwd: string) {
		const journalPath = path.join(cwd, ".spider", "tx_journal.json")
		if (!fs.existsSync(journalPath)) return

		try {
			const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"))
			Logger.warn(`[SovereignTransaction] STALE JOURNAL DETECTED: Recovering transaction ${journal.id}...`)

			// Rollback logic for the stale steps
			for (const step of [...journal.steps].reverse()) {
				if (step.originalContent !== null) {
					fs.writeFileSync(step.path, step.originalContent)
				} else {
					if (fs.existsSync(step.path)) fs.unlinkSync(step.path)
				}
			}
			fs.unlinkSync(journalPath)
			Logger.info(`[SovereignTransaction] Recovery successful for ${journal.id}.`)
		} catch (e) {
			Logger.error(`[SovereignTransaction] Recovery failed:`, e)
		}
	}

	public async commit(): Promise<{ success: boolean; error?: string }> {
		try {
			for (const step of this.steps) {
				if (step.type === "WRITE" && step.newContent !== null) {
					fs.writeFileSync(step.path, step.newContent)
				} else if (step.type === "DELETE") {
					if (fs.existsSync(step.path)) fs.unlinkSync(step.path)
				}
			}
			this.isActive = false
			this.clearJournal()
			return { success: true }
		} catch (e: any) {
			await this.rollback()
			return { success: false, error: e.message }
		}
	}

	public async rollback() {
		Logger.info(`Rolling back transaction ${this.id}...`)
		for (const step of [...this.steps].reverse()) {
			if (step.originalContent !== null) {
				fs.writeFileSync(step.path, step.originalContent)
			} else {
				if (fs.existsSync(step.path)) fs.unlinkSync(step.path)
			}
		}
		this.isActive = false
	}
}
