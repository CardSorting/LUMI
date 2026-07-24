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
		} catch (_error) {
			return null
		}
	}

	public static async loadAndValidate(taskId: string, workspaceDir?: string): Promise<MoDRunState | null> {
		const state = await ReceiptStore.load(taskId)
		if (!state || !workspaceDir || !state.checkpointHashes) return state

		// Validate file mtimes against checkpoints
		for (const [relPath, savedMtime] of Object.entries(state.checkpointHashes)) {
			try {
				const fullPath = path.isAbsolute(relPath) ? relPath : path.join(workspaceDir, relPath)
				const stat = await fs.stat(fullPath)
				const currentMtime = stat.mtimeMs.toString()

				if (savedMtime !== currentMtime) {
					Logger.warn(`[MoD DAG Invalidation] File ${relPath} changed out-of-band. Invalidating downstream tasks.`)
					for (const task of state.implementationTasks || []) {
						if ((task.affectedFiles || []).includes(relPath) || (task.mutationBoundary || []).includes(relPath)) {
							task.status = "pending"
						}
					}
				}
			} catch {
				for (const task of state.implementationTasks || []) {
					if ((task.affectedFiles || []).includes(relPath) || (task.mutationBoundary || []).includes(relPath)) {
						task.status = "pending"
					}
				}
			}
		}

		return state
	}
}
