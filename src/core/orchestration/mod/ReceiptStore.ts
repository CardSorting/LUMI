import { ensureTaskDirectoryExists } from "@core/storage/disk"
import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { MoDRunState } from "./types"

export class ReceiptStore {
	public static async save(taskId: string, state: MoDRunState): Promise<void> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, "mod_run_state.json")
			await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8")
			Logger.info(`[MoD] Saved run state to receipt file: ${filePath}`)
		} catch (error) {
			Logger.error(`[MoD] Failed to save run state for task ${taskId}:`, error)
		}
	}

	public static async load(taskId: string): Promise<MoDRunState | null> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, "mod_run_state.json")
			const content = await fs.readFile(filePath, "utf8")
			Logger.info(`[MoD] Loaded run state from receipt file: ${filePath}`)
			return JSON.parse(content) as MoDRunState
		} catch (error) {
			// File does not exist or cannot be parsed
			return null
		}
	}
}
