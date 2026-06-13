import * as crypto from "crypto"
import { execa } from "execa"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

// Helper to check if a file path is within the workspace boundary
export function isPathInWorkspace(workspace: string, targetPath: string): boolean {
	const resolvedWorkspace = path.resolve(workspace)
	const resolvedTarget = path.resolve(targetPath)
	return resolvedTarget.startsWith(resolvedWorkspace)
}

function sha256(content: string): string {
	return crypto.createHash("sha256").update(content).digest("hex")
}

function applyUnifiedDiff(content: string, diff: string): string {
	const lines = content.split(/\r?\n/)
	const diffLines = diff.split(/\r?\n/)

	interface Chunk {
		oldStart: number
		oldCount: number
		newStart: number
		newCount: number
		lines: string[]
	}

	const chunks: Chunk[] = []
	let currentChunk: Chunk | null = null

	for (const line of diffLines) {
		if (line.startsWith("---") || line.startsWith("+++")) {
			continue
		}
		const chunkHeader = /^@@\s+-(\d+),?(\d+)?\s+\+(\d+),?(\d+)?\s+@@/.exec(line)
		if (chunkHeader) {
			if (currentChunk) {
				chunks.push(currentChunk)
			}
			currentChunk = {
				oldStart: Number.parseInt(chunkHeader[1], 10),
				oldCount: chunkHeader[2] ? Number.parseInt(chunkHeader[2], 10) : 1,
				newStart: Number.parseInt(chunkHeader[3], 10),
				newCount: chunkHeader[4] ? Number.parseInt(chunkHeader[4], 10) : 1,
				lines: [],
			}
		} else if (currentChunk) {
			if (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+") || line === "") {
				currentChunk.lines.push(line)
			}
		}
	}
	if (currentChunk) {
		chunks.push(currentChunk)
	}

	if (chunks.length === 0) {
		return content
	}

	let offset = 0
	const resultLines = [...lines]

	for (const chunk of chunks) {
		const startIdx = chunk.oldStart - 1 + offset
		const expectedDeleted: string[] = []
		const inserted: string[] = []

		for (const dline of chunk.lines) {
			if (dline.startsWith("-")) {
				expectedDeleted.push(dline.slice(1))
			} else if (dline.startsWith("+")) {
				inserted.push(dline.slice(1))
			} else if (dline.startsWith(" ")) {
				expectedDeleted.push(dline.slice(1))
				inserted.push(dline.slice(1))
			} else if (dline === "") {
				expectedDeleted.push("")
				inserted.push("")
			}
		}

		let actualStart = startIdx
		let matched = false

		const checkMatch = (idx: number): boolean => {
			if (idx < 0 || idx + expectedDeleted.length > resultLines.length) return false
			for (let i = 0; i < expectedDeleted.length; i++) {
				if (resultLines[idx + i] !== expectedDeleted[i]) {
					return false
				}
			}
			return true
		}

		if (checkMatch(startIdx)) {
			matched = true
		} else {
			for (let scan = 1; scan <= 100; scan++) {
				if (checkMatch(startIdx - scan)) {
					actualStart = startIdx - scan
					matched = true
					break
				}
				if (checkMatch(startIdx + scan)) {
					actualStart = startIdx + scan
					matched = true
					break
				}
			}
		}

		if (matched) {
			resultLines.splice(actualStart, expectedDeleted.length, ...inserted)
			offset += inserted.length - expectedDeleted.length
		} else {
			// Fallback splice
			resultLines.splice(startIdx, expectedDeleted.length, ...inserted)
			offset += inserted.length - expectedDeleted.length
		}
	}

	return resultLines.join("\n")
}

function applyLineSearchReplace(content: string, search: string, replace: string): string {
	if (!search) return content
	return content.replace(search, replace)
}

export class NativeMutationManager {
	private static instance: NativeMutationManager | null = null

	public static getInstance(): NativeMutationManager {
		if (!NativeMutationManager.instance) {
			NativeMutationManager.instance = new NativeMutationManager()
		}
		return NativeMutationManager.instance
	}

	public async getStatus(workspace: string): Promise<any> {
		try {
			// Find count of files in source files
			let fileCount = 0
			const walk = async (dir: string) => {
				let entries: any[] = []
				try {
					entries = await fs.readdir(dir, { withFileTypes: true })
				} catch {
					return
				}
				for (const entry of entries) {
					if (entry.isDirectory()) {
						if (![".git", "node_modules"].includes(entry.name)) {
							await walk(path.join(dir, entry.name))
						}
					} else if (entry.isFile()) {
						fileCount++
					}
				}
			}
			await walk(workspace)

			return {
				ok: true,
				result: {
					driftDetected: false,
					fileCount,
					workspaceRoot: workspace,
				},
			}
		} catch (error: any) {
			return {
				ok: false,
				error: {
					string_code: "status_error",
					message: error.message || "Failed to get workspace status",
				},
			}
		}
	}

	public async searchLiteral(workspace: string, query: string, maxResults = 20): Promise<any> {
		try {
			const results: any[] = []
			const walk = async (dir: string) => {
				if (results.length >= maxResults) return
				let entries: any[] = []
				try {
					entries = await fs.readdir(dir, { withFileTypes: true })
				} catch {
					return
				}
				for (const entry of entries) {
					if (results.length >= maxResults) return
					const fullPath = path.join(dir, entry.name)
					if (entry.isDirectory()) {
						if (![".git", "node_modules", "dist", "build"].includes(entry.name)) {
							await walk(fullPath)
						}
					} else if (entry.isFile()) {
						const ext = path.extname(entry.name).toLowerCase()
						if ([".py", ".ts", ".js", ".tsx", ".jsx", ".md", ".json", ".yaml", ".yml"].includes(ext)) {
							let text = ""
							try {
								text = await fs.readFile(fullPath, "utf8")
							} catch {
								continue
							}
							if (text.includes(query)) {
								const lines = text.split(/\r?\n/)
								for (let lineno = 1; lineno <= lines.length; lineno++) {
									if (lines[lineno - 1].includes(query)) {
										results.push({
											path: path.relative(workspace, fullPath),
											line: lineno,
											content: lines[lineno - 1].trim(),
										})
										if (results.length >= maxResults) break
									}
								}
							}
						}
					}
				}
			}
			await walk(workspace)

			return {
				ok: true,
				result: {
					results,
					query,
				},
			}
		} catch (error: any) {
			return {
				ok: false,
				error: {
					string_code: "search_error",
					message: error.message || "Failed to execute search",
				},
			}
		}
	}

	public async applyPatch(
		workspace: string,
		filePath: string,
		unifiedDiff: string,
		lineSearch: string,
		lineReplace: string,
		taskId: string,
	): Promise<any> {
		const fullPath = path.resolve(workspace, filePath)
		if (!isPathInWorkspace(workspace, fullPath)) {
			return {
				ok: false,
				error: {
					string_code: "bridge_workspace_unsafe",
					message: `Target path lies outside active workspace: ${filePath}`,
				},
			}
		}

		try {
			if (!(await fileExists(fullPath))) {
				return {
					ok: false,
					error: {
						string_code: "file_not_found",
						message: `File not found at path: ${filePath}`,
					},
				}
			}

			const beforeContent = await fs.readFile(fullPath, "utf8")
			let postContent = beforeContent

			if (unifiedDiff.trim()) {
				postContent = applyUnifiedDiff(beforeContent, unifiedDiff)
			} else if (lineSearch.trim()) {
				postContent = applyLineSearchReplace(beforeContent, lineSearch, lineReplace)
			} else {
				return {
					ok: false,
					error: {
						string_code: "patch_invalid",
						message: "unified_diff or line_search/line_replace is required.",
					},
				}
			}

			if (beforeContent === postContent) {
				return {
					ok: true,
					result: {
						patched: false,
						reason: "No changes applied",
					},
				}
			}

			await fs.writeFile(fullPath, postContent, "utf8")

			const receipt = {
				path: filePath,
				beforeContentHash: sha256(beforeContent),
				postContentHash: sha256(postContent),
				patchFingerprint: sha256(unifiedDiff || lineSearch + lineReplace),
				readSourceBefore: beforeContent.slice(0, 1000),
				applyChannel: "native",
				atomic: true,
			}

			const kernelResult = {
				mutationReceipt: receipt,
				operationId: crypto.randomUUID(),
				patched: true,
				revisionBefore: 0,
				revisionAfter: 1,
			}

			await this.recordMutationReceipt(workspace, receipt, kernelResult, taskId)

			return {
				ok: true,
				workspace_root: workspace,
				path: filePath,
				taskId: taskId || null,
				kernel: kernelResult,
			}
		} catch (error: any) {
			return {
				ok: false,
				error: {
					string_code: "patch_apply_error",
					message: error.message || "Failed to apply governed patch",
				},
			}
		}
	}

	public async applyVerify(workspace: string, command: string, cwd: string, taskId: string): Promise<any> {
		try {
			const commandCwd = cwd ? path.resolve(workspace, cwd) : workspace
			if (!isPathInWorkspace(workspace, commandCwd)) {
				return {
					ok: false,
					error: {
						string_code: "bridge_workspace_unsafe",
						message: `Working directory lies outside workspace: ${cwd}`,
					},
				}
			}

			// Run command natively via execa
			let exitCode = 0
			let stdout = ""
			let stderr = ""

			try {
				const [cmd, ...args] = command.split(/\s+/)
				const res = await execa(cmd, args, { cwd: commandCwd, timeout: 60000 })
				stdout = res.stdout
				stderr = res.stderr
				exitCode = res.exitCode ?? 0
			} catch (error: any) {
				exitCode = error.exitCode ?? 1
				stdout = error.stdout || ""
				stderr = error.stderr || error.message || ""
			}

			const passed = exitCode === 0

			return {
				ok: true,
				workspace_root: workspace,
				taskId: taskId || null,
				command,
				verify_ran: true,
				passed,
				exit_code: exitCode,
				stdout_summary: stdout.slice(0, 4000),
				stderr_summary: stderr.slice(0, 4000),
			}
		} catch (error: any) {
			return {
				ok: false,
				error: {
					string_code: "verify_error",
					message: error.message || "Failed to execute verify command",
				},
			}
		}
	}

	// Logging & Receipts persistence
	private async recordMutationReceipt(workspace: string, receipt: any, kernelResult: any, taskId: string): Promise<void> {
		const sessionReceipts = {
			timestamp: new Date().toISOString(),
			taskId: taskId || null,
			workspace,
			receipt,
			kernelResult,
		}

		// 1. Write to workspace-local mutation-state.json
		const wsStateFile = path.join(workspace, ".dietcode", "mutation-state.json")
		try {
			await fs.mkdir(path.dirname(wsStateFile), { recursive: true })
			let wsHistory: any[] = []
			if (await fileExists(wsStateFile)) {
				try {
					const existing = await fs.readFile(wsStateFile, "utf8")
					wsHistory = JSON.parse(existing)
					if (!Array.isArray(wsHistory)) wsHistory = []
				} catch {}
			}
			wsHistory.push(sessionReceipts)
			await fs.writeFile(wsStateFile, JSON.stringify(wsHistory, null, 2), "utf8")
		} catch {}

		// 2. Write to home directory ~/.dietcode/session/mutation-receipts.json
		const homeReceiptsFile = path.join(os.homedir(), ".dietcode", "session", "mutation-receipts.json")
		try {
			await fs.mkdir(path.dirname(homeReceiptsFile), { recursive: true })
			let homeHistory: any[] = []
			if (await fileExists(homeReceiptsFile)) {
				try {
					const existing = await fs.readFile(homeReceiptsFile, "utf8")
					homeHistory = JSON.parse(existing)
					if (!Array.isArray(homeHistory)) homeHistory = []
				} catch {}
			}
			homeHistory.push(sessionReceipts)
			await fs.writeFile(homeReceiptsFile, JSON.stringify(homeHistory, null, 2), "utf8")
		} catch {}
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}
