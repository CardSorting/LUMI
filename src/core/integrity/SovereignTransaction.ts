import * as fs from "fs"
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

	constructor(private id: string) {}

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
			newContent
		})
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
