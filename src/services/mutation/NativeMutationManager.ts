import * as crypto from "crypto"
import { execa } from "execa"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

// Helper to check if a file path is safely within the workspace boundary, resolving all symlinks
export async function isPathInWorkspace(workspace: string, targetPath: string): Promise<boolean> {
	try {
		const resolvedWorkspace = await fs.realpath(path.resolve(workspace))
		let current = path.resolve(targetPath)

		// Resolve nearest existing ancestor directory to safely check non-existent targets
		while (true) {
			try {
				const realCurrent = await fs.realpath(current)
				return realCurrent === resolvedWorkspace || realCurrent.startsWith(resolvedWorkspace + path.sep)
			} catch (err: any) {
				if (err.code === "ENOENT") {
					const parent = path.dirname(current)
					if (parent === current) {
						break
					}
					current = parent
				} else {
					return false
				}
			}
		}
		return false
	} catch {
		return false
	}
}

// Normalized line-ending SHA-256 file hashing to prevent cross-platform differences
function getNormalizedHash(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n")
	return crypto.createHash("sha256").update(normalized).digest("hex")
}

async function getFileHash(filePath: string): Promise<string> {
	try {
		const content = await fs.readFile(filePath, "utf8")
		return getNormalizedHash(content)
	} catch {
		return ""
	}
}

async function runGit(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execa("git", args, { cwd, timeout: 5000 })
		return stdout.trim()
	} catch {
		return ""
	}
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

export interface CoherenceToken {
	tokenId: string
	taskId: string
	workspaceRevision: number
	verifyRevision: number
	anchors: Record<string, string> // relative path -> hash
	createdAt: string
	expiresAt: string
}

export interface MutationState {
	workspaceRevision: number
	verifyRevision: number
	contextRefreshId: number
	trackedFileHashes: Record<string, string>
	coherenceTokens: Record<string, CoherenceToken>
	anchorGitHead?: string
	anchorRefreshedAt?: string
	lastVerifiedCommand?: string
	lastVerifiedAt?: string
	lastVerifyPassed?: boolean
}

export class NativeMutationManager {
	private static instance: NativeMutationManager | null = null

	public static getInstance(): NativeMutationManager {
		if (!NativeMutationManager.instance) {
			NativeMutationManager.instance = new NativeMutationManager()
		}
		return NativeMutationManager.instance
	}

	private async readMutationState(workspace: string): Promise<MutationState> {
		const stateFile = path.join(workspace, ".dietcode", "mutation-state.json")
		try {
			const data = await fs.readFile(stateFile, "utf8")
			const parsed = JSON.parse(data)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.workspaceRevision) {
				return parsed
			}
		} catch {}
		return {
			workspaceRevision: 1,
			verifyRevision: 0,
			contextRefreshId: 1,
			trackedFileHashes: {},
			coherenceTokens: {},
		}
	}

	private async writeMutationState(workspace: string, state: MutationState): Promise<void> {
		const stateFile = path.join(workspace, ".dietcode", "mutation-state.json")
		try {
			await fs.mkdir(path.dirname(stateFile), { recursive: true })
			await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8")
		} catch {}
	}

	/** Lightweight revision projection for consumers that only need cache invalidation. */
	public async getWorkspaceRevision(workspace: string): Promise<number> {
		return (await this.readMutationState(workspace)).workspaceRevision
	}

	public async getStatus(workspace: string, taskId?: string): Promise<any> {
		try {
			const state = await this.readMutationState(workspace)
			const gitHead = await runGit(workspace, ["rev-parse", "HEAD"])
			const gitBranch = await runGit(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])
			const statusLines = (await runGit(workspace, ["status", "--porcelain"])).split(/\r?\n/).filter(Boolean)

			const dirtyFiles: string[] = []
			for (const line of statusLines) {
				const relPath = line.slice(3).trim()
				if (relPath) {
					dirtyFiles.push(relPath)
				}
			}

			// Compute affectedFiles by checking tracked anchors
			const affectedFiles: any[] = []
			for (const relPath in state.trackedFileHashes) {
				const fullPath = path.resolve(workspace, relPath)
				const currentHash = await getFileHash(fullPath)
				const anchorHash = state.trackedFileHashes[relPath]
				if (anchorHash && currentHash && anchorHash !== currentHash) {
					affectedFiles.push({
						path: relPath,
						reason: "changed since agent read it",
						anchorHash,
						currentHash,
						source: "tracked_hash",
					})
				}
			}

			if (state.anchorGitHead && gitHead && state.anchorGitHead !== gitHead) {
				affectedFiles.push({
					path: "(git HEAD)",
					reason: "git HEAD moved since context anchor",
					anchorGitHead: state.anchorGitHead,
					currentGitHead: gitHead,
					source: "git_head",
				})
			}

			const driftDetected = affectedFiles.length > 0
			let activeToken: any = null
			if (taskId) {
				activeToken = await this.issueCoherenceToken(workspace, taskId, [])
			}

			return {
				ok: true,
				result: {
					mode: "workspace_status",
					workspaceRoot: workspace,
					workspaceRevision: state.workspaceRevision,
					verifyRevision: state.verifyRevision,
					contextRefreshId: state.contextRefreshId,
					gitHead,
					gitBranch,
					anchorGitHead: state.anchorGitHead || "",
					anchorRefreshedAt: state.anchorRefreshedAt || "",
					dirtyFiles,
					affectedFiles,
					driftDetected,
					coherenceToken: activeToken,
					requiresContextRefresh: driftDetected,
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

	public async issueCoherenceToken(workspace: string, taskId: string, paths: string[]): Promise<any> {
		const state = await this.readMutationState(workspace)
		let existingTokenId: string | null = null
		for (const tokenId in state.coherenceTokens) {
			if (state.coherenceTokens[tokenId].taskId === taskId) {
				existingTokenId = tokenId
				break
			}
		}

		const now = new Date()
		const expiresAt = new Date(now.getTime() + 300000) // 5 min TTL

		let token: CoherenceToken
		if (existingTokenId) {
			token = state.coherenceTokens[existingTokenId]
			token.workspaceRevision = state.workspaceRevision
			token.verifyRevision = state.verifyRevision
			token.expiresAt = expiresAt.toISOString()
		} else {
			const seq = Object.keys(state.coherenceTokens).length + 1
			const tokenId = `coh_${seq}`
			token = {
				tokenId,
				taskId,
				workspaceRevision: state.workspaceRevision,
				verifyRevision: state.verifyRevision,
				anchors: {},
				createdAt: now.toISOString(),
				expiresAt: expiresAt.toISOString(),
			}
			state.coherenceTokens[tokenId] = token
		}

		if (!state.anchorGitHead) {
			state.anchorGitHead = await runGit(workspace, ["rev-parse", "HEAD"])
			state.anchorRefreshedAt = now.toISOString()
		}

		const pathsToAnchor = new Set([...paths, ...Object.keys(state.trackedFileHashes)])
		for (const relPath of pathsToAnchor) {
			if (!relPath) continue
			const fullPath = path.resolve(workspace, relPath)
			const currentHash = await getFileHash(fullPath)
			if (currentHash) {
				token.anchors[relPath] = currentHash
				state.trackedFileHashes[relPath] = currentHash
			}
		}

		await this.writeMutationState(workspace, state)
		return {
			tokenId: token.tokenId,
			workspaceRevision: token.workspaceRevision,
			verifyRevision: token.verifyRevision,
			anchors: token.anchors,
		}
	}

	public async refreshAnchor(workspace: string, paths?: string[]): Promise<any> {
		const state = await this.readMutationState(workspace)
		const gitHead = await runGit(workspace, ["rev-parse", "HEAD"])
		const now = new Date().toISOString()

		state.anchorGitHead = gitHead
		state.anchorRefreshedAt = now
		state.contextRefreshId += 1

		const pathsToRefresh = paths && paths.length > 0 ? paths : Object.keys(state.trackedFileHashes)
		for (const relPath of pathsToRefresh) {
			const fullPath = path.resolve(workspace, relPath)
			const currentHash = await getFileHash(fullPath)
			if (currentHash) {
				state.trackedFileHashes[relPath] = currentHash
			} else {
				delete state.trackedFileHashes[relPath]
			}
		}

		for (const tokenId in state.coherenceTokens) {
			const token = state.coherenceTokens[tokenId]
			token.workspaceRevision = state.workspaceRevision
			token.verifyRevision = state.verifyRevision
			for (const relPath of pathsToRefresh) {
				const fullPath = path.resolve(workspace, relPath)
				const currentHash = await getFileHash(fullPath)
				if (currentHash) {
					token.anchors[relPath] = currentHash
				} else {
					delete token.anchors[relPath]
				}
			}
		}

		await this.writeMutationState(workspace, state)
		return {
			ok: true,
			result: {
				contextRefreshId: state.contextRefreshId,
				anchorGitHead: state.anchorGitHead,
				anchorRefreshedAt: state.anchorRefreshedAt,
			},
		}
	}

	public async autoTrackFileRead(workspace: string, filePath: string, taskId: string): Promise<void> {
		if (!taskId) return
		const fullPath = path.resolve(workspace, filePath)
		if (!(await isPathInWorkspace(workspace, fullPath))) return
		try {
			const relPath = path.relative(workspace, fullPath)
			const currentHash = await getFileHash(fullPath)
			if (!currentHash) return

			const state = await this.readMutationState(workspace)
			state.trackedFileHashes[relPath] = currentHash

			for (const tokenId in state.coherenceTokens) {
				const token = state.coherenceTokens[tokenId]
				if (token.taskId === taskId) {
					token.anchors[relPath] = currentHash
				}
			}

			await this.writeMutationState(workspace, state)
		} catch {}
	}

	private async validateCoherence(
		workspace: string,
		taskId: string,
		coherenceTokenId?: string,
		expectedWorkspaceRevision?: number,
	): Promise<{ ok: boolean; reason?: string; message?: string; details?: any }> {
		const state = await this.readMutationState(workspace)

		if (!coherenceTokenId || expectedWorkspaceRevision === undefined) {
			return {
				ok: false,
				reason: "token_required",
				message:
					"Mutating RPC requires coherenceTokenId and expectedWorkspaceRevision when taskId is set. Call dietcode_kernel(action='status') or read the files again to obtain a token.",
				details: {
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		const token = state.coherenceTokens[coherenceTokenId]
		if (!token) {
			return {
				ok: false,
				reason: "token_unknown",
				message:
					"Coherence token is missing or unknown. Please obtain a new coherence token by calling dietcode_kernel(action='status') or reading the target files.",
				details: {
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		const now = new Date()
		const expiresAt = new Date(token.expiresAt)
		if (now > expiresAt) {
			return {
				ok: false,
				reason: "token_expired",
				message:
					"Coherence token has expired. Please refresh the coherence token by calling dietcode_kernel(action='status') or reading the target files.",
				details: {
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		if (token.taskId !== taskId) {
			return {
				ok: false,
				reason: "token_task_mismatch",
				message: "Coherence token does not match taskId. Please ensure the coherence token matches the current task.",
				details: {
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		if (expectedWorkspaceRevision !== state.workspaceRevision) {
			return {
				ok: false,
				reason: "workspace_changed",
				message: `Workspace revision changed. Expected ${expectedWorkspaceRevision}, current is ${state.workspaceRevision}. Another task or change has updated the workspace. Please review the changes, call dietcode_kernel(action='status') to refresh the workspace revision, and retry.`,
				details: {
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		if (token.verifyRevision !== state.verifyRevision) {
			return {
				ok: false,
				reason: "verify_revision_stale",
				message:
					"Verification revision changed since this task observed state. A verify command has run. Please refresh your state with dietcode_kernel(action='status') before proceeding.",
				details: {
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		const changedPaths: string[] = []
		for (const relPath in token.anchors) {
			const anchorHash = token.anchors[relPath]
			const fullPath = path.resolve(workspace, relPath)
			const currentHash = await getFileHash(fullPath)
			if (anchorHash && currentHash && anchorHash !== currentHash) {
				changedPaths.push(relPath)
			}
		}

		if (changedPaths.length > 0) {
			return {
				ok: false,
				reason: "coherence_mismatch",
				message: `Anchored file content changed since this task read it. The following files have changed on disk: ${changedPaths.join(", ")}. Please use standard file read tools (e.g. read_file) to inspect the changes and synchronize your context before applying the patch.`,
				details: {
					changedPaths,
					requiredAction: "refresh_context",
					currentWorkspaceRevision: state.workspaceRevision,
				},
			}
		}

		return { ok: true }
	}

	public async applyPatch(
		workspace: string,
		filePath: string,
		unifiedDiff: string,
		lineSearch: string,
		lineReplace: string,
		taskId: string,
		coherenceTokenId?: string,
		expectedWorkspaceRevision?: number,
	): Promise<any> {
		const fullPath = path.resolve(workspace, filePath)
		if (!(await isPathInWorkspace(workspace, fullPath))) {
			return {
				ok: false,
				error: {
					string_code: "bridge_workspace_unsafe",
					message: `Target path lies outside active workspace: ${filePath}`,
				},
			}
		}

		if (!(await fileExists(fullPath))) {
			return {
				ok: false,
				error: {
					string_code: "file_not_found",
					message: `File not found at path: ${filePath}`,
				},
			}
		}

		if (taskId) {
			const coherenceCheck = await this.validateCoherence(workspace, taskId, coherenceTokenId, expectedWorkspaceRevision)
			if (!coherenceCheck.ok) {
				return {
					ok: false,
					error: {
						string_code: coherenceCheck.reason,
						message: coherenceCheck.message,
						details: coherenceCheck.details,
					},
				}
			}
		}

		try {
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

			const beforeHash = getNormalizedHash(beforeContent)
			const postHash = getNormalizedHash(postContent)

			const receipt = {
				path: filePath,
				beforeContentHash: beforeHash,
				postContentHash: postHash,
				patchFingerprint: crypto
					.createHash("sha256")
					.update(unifiedDiff || lineSearch + lineReplace)
					.digest("hex"),
				readSourceBefore: beforeContent.slice(0, 1000),
				applyChannel: "native",
				atomic: true,
			}

			const stateBefore = await this.readMutationState(workspace)
			const revisionBefore = stateBefore.workspaceRevision
			const revisionAfter = revisionBefore + 1

			const kernelResult = {
				mutationReceipt: receipt,
				operationId: crypto.randomUUID(),
				patched: true,
				revisionBefore,
				revisionAfter,
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
			if (!(await isPathInWorkspace(workspace, commandCwd))) {
				return {
					ok: false,
					error: {
						string_code: "bridge_workspace_unsafe",
						message: `Working directory lies outside workspace: ${cwd}`,
					},
				}
			}

			let exitCode = 0
			let stdout = ""
			let stderr = ""

			try {
				const res = await execa(command, { shell: true, cwd: commandCwd, timeout: 60000 })
				stdout = res.stdout
				stderr = res.stderr
				exitCode = res.exitCode ?? 0
			} catch (error: any) {
				exitCode = error.exitCode ?? 1
				stdout = error.stdout || ""
				stderr = error.stderr || error.message || ""
			}

			const passed = exitCode === 0

			// Update state's verifyRevision on run
			const state = await this.readMutationState(workspace)
			if (passed) {
				state.verifyRevision += 1
			}
			state.lastVerifiedCommand = command
			state.lastVerifiedAt = new Date().toISOString()
			state.lastVerifyPassed = passed
			await this.writeMutationState(workspace, state)

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

	private async recordMutationReceipt(workspace: string, receipt: any, kernelResult: any, taskId: string): Promise<void> {
		const sessionReceipts = {
			timestamp: new Date().toISOString(),
			taskId: taskId || null,
			workspace,
			receipt,
			kernelResult,
		}

		const wsHistoryFile = path.join(workspace, ".dietcode", "mutation-history.json")
		try {
			let wsHistory: any[] = []
			if (await fileExists(wsHistoryFile)) {
				try {
					const existing = await fs.readFile(wsHistoryFile, "utf8")
					wsHistory = JSON.parse(existing)
					if (!Array.isArray(wsHistory)) wsHistory = []
				} catch {}
			}
			wsHistory.push(sessionReceipts)
			await fs.writeFile(wsHistoryFile, JSON.stringify(wsHistory, null, 2), "utf8")
		} catch {}

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

		const state = await this.readMutationState(workspace)
		state.workspaceRevision += 1
		state.trackedFileHashes[receipt.path] = receipt.postContentHash

		for (const tokenId in state.coherenceTokens) {
			const token = state.coherenceTokens[tokenId]
			token.anchors[receipt.path] = receipt.postContentHash
		}

		await this.writeMutationState(workspace, state)
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
