import chokidar, { FSWatcher } from "chokidar"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import path from "path"
import { Logger } from "@/shared/services/Logger"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

const MAX_ACCESS_DECISIONS = 4_096

type ReadTextFile = (filePath: string, encoding: "utf8") => Promise<string>

export interface DietCodeIgnoreControllerOptions {
	/** Injectable for deterministic policy-reload tests. */
	readFile?: ReadTextFile
}

type IgnorePolicySnapshot = {
	content: string | undefined
	hasPolicyFile: boolean
	ignoreInstance: Ignore
	includePaths: Set<string>
	identity: string
}

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in DietCode.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .dietcodeignore files.
 */
export class DietCodeIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private fileWatcher?: FSWatcher
	private readonly readFile: ReadTextFile
	private hasPolicyFile = false
	private policyGeneration = 0
	private policyIdentity: string | undefined
	private reloadRequest = 0
	private activeIncludePaths = new Set<string>()
	private readonly accessDecisionCache = new Map<string, boolean>()
	dietcodeIgnoreContent: string | undefined

	constructor(cwd: string, options: DietCodeIgnoreControllerOptions = {}) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.readFile = options.readFile ?? ((filePath, encoding) => fs.readFile(filePath, encoding))
		this.dietcodeIgnoreContent = undefined
	}

	/**
	 * Initialize the controller by loading custom patterns and setting up file watcher
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		// Set up file watcher for .dietcodeignore
		this.setupFileWatcher()
		await this.refreshPolicy()
	}

	/** Monotonic identity for task-local authority and result-cache invalidation. */
	getPolicyGeneration(): number {
		return this.policyGeneration
	}

	/**
	 * Mutation handoff for the task runtime. Policy-file writes are uncommon, so
	 * synchronously reload only when the completed target is the root policy or
	 * one of its active includes. This closes the watcher-delivery race without
	 * adding filesystem work to ordinary mutations.
	 */
	async refreshPolicyIfAffected(filePath: string): Promise<boolean> {
		const absolutePath = path.resolve(this.cwd, filePath)
		const ignorePath = path.resolve(this.cwd, ".dietcodeignore")
		const affected =
			pathsEqual(absolutePath, ignorePath) || [...this.activeIncludePaths].some((p) => pathsEqual(p, absolutePath))
		if (!affected) return false
		await this.refreshPolicy()
		return true
	}

	/**
	 * Reload the policy without waiting for watcher delivery. Concurrent reloads
	 * commit latest-request-wins, so an older slow read can never replace a newer
	 * policy snapshot.
	 */
	async refreshPolicy(): Promise<void> {
		const request = ++this.reloadRequest
		try {
			const snapshot = await this.buildPolicySnapshot()
			if (request !== this.reloadRequest) {
				return
			}
			this.commitPolicySnapshot(snapshot)
		} catch (error) {
			// Retain the last complete snapshot. A partially loaded policy must never
			// become visible to access checks.
			Logger.error("Unexpected error loading .dietcodeignore:", error)
		}
	}

	/**
	 * Set up the file watcher for .dietcodeignore changes
	 */
	private setupFileWatcher(): void {
		const ignorePath = path.join(this.cwd, ".dietcodeignore")

		this.fileWatcher = chokidar.watch(ignorePath, {
			persistent: true, // Keep the process running as long as files are being watched
			ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
			awaitWriteFinish: {
				// Wait for writes to finish before emitting events (handles chunked writes)
				stabilityThreshold: 100, // Wait 100ms for file size to remain constant
				pollInterval: 100, // Check file size every 100ms while waiting for stability
			},
			atomic: true, // Handle atomic writes where editors write to a temp file then rename
		})

		// Watch for file changes, creation, and deletion
		this.fileWatcher.on("change", () => {
			void this.refreshPolicy()
		})

		this.fileWatcher.on("add", () => {
			void this.refreshPolicy()
		})

		this.fileWatcher.on("unlink", () => {
			void this.refreshPolicy()
		})

		this.fileWatcher.on("error", (error) => {
			Logger.error("Error watching .dietcodeignore file:", error)
		})
	}

	private async buildPolicySnapshot(): Promise<IgnorePolicySnapshot> {
		const ignorePath = path.join(this.cwd, ".dietcodeignore")
		const nextIgnoreInstance = ignore()
		let content: string | undefined
		try {
			content = await this.readFile(ignorePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error
			}
		}

		if (content === undefined) {
			return {
				content: undefined,
				hasPolicyFile: false,
				ignoreInstance: nextIgnoreInstance,
				includePaths: new Set(),
				identity: "absent",
			}
		}

		const { combinedContent, includePaths } = await this.processIgnoreContent(content)
		nextIgnoreInstance.add(combinedContent)
		// The policy file itself is never readable, including when it is empty.
		nextIgnoreInstance.add(".dietcodeignore")

		return {
			content,
			hasPolicyFile: true,
			ignoreInstance: nextIgnoreInstance,
			includePaths,
			identity: JSON.stringify({ combinedContent, includePaths: [...includePaths].sort() }),
		}
	}

	private commitPolicySnapshot(snapshot: IgnorePolicySnapshot): void {
		const policyChanged = snapshot.identity !== this.policyIdentity
		this.ignoreInstance = snapshot.ignoreInstance
		this.dietcodeIgnoreContent = snapshot.content
		this.hasPolicyFile = snapshot.hasPolicyFile
		this.policyIdentity = snapshot.identity
		this.updateIncludeWatches(snapshot.includePaths)

		if (policyChanged) {
			this.policyGeneration++
			this.accessDecisionCache.clear()
		}
	}

	private updateIncludeWatches(nextIncludePaths: Set<string>): void {
		const watcher = this.fileWatcher
		if (watcher) {
			const removed = [...this.activeIncludePaths].filter((includePath) => !nextIncludePaths.has(includePath))
			const added = [...nextIncludePaths].filter((includePath) => !this.activeIncludePaths.has(includePath))
			if (removed.length > 0) {
				try {
					watcher.unwatch(removed)
				} catch (error) {
					Logger.error("Error removing .dietcodeignore include watches:", error)
				}
			}
			if (added.length > 0) {
				watcher.add(added)
			}
		}
		this.activeIncludePaths = new Set(nextIncludePaths)
	}

	private async processIgnoreContent(content: string): Promise<{ combinedContent: string; includePaths: Set<string> }> {
		if (!content.includes("!include ")) {
			return { combinedContent: content, includePaths: new Set() }
		}
		return this.processDietCodeIgnoreIncludes(content)
	}

	private async processDietCodeIgnoreIncludes(
		content: string,
	): Promise<{ combinedContent: string; includePaths: Set<string> }> {
		let combinedContent = ""
		const includePaths = new Set<string>()
		const lines = content.split(/\r?\n/)

		for (const line of lines) {
			const trimmedLine = line.trim()
			if (!trimmedLine.startsWith("!include ")) {
				combinedContent += `\n${line}`
				continue
			}

			const includePath = path.resolve(this.cwd, trimmedLine.substring("!include ".length).trim())
			includePaths.add(includePath)
			const includedContent = await this.readIncludedFile(includePath)
			if (includedContent) {
				combinedContent += `\n${includedContent}`
			}
		}

		return { combinedContent, includePaths }
	}

	private async readIncludedFile(resolvedIncludePath: string): Promise<string | null> {
		try {
			return await this.readFile(resolvedIncludePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				Logger.debug(`[DietCodeIgnore] Included file not found: ${resolvedIncludePath}`)
				return null
			}
			throw error
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Always allow access if .dietcodeignore does not exist
		if (!this.hasPolicyFile) {
			return true
		}
		try {
			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath).replace(/\\/g, "/")
			const cached = this.accessDecisionCache.get(relativePath)
			if (cached !== undefined) {
				// LRU touch without copying the bounded map.
				this.accessDecisionCache.delete(relativePath)
				this.accessDecisionCache.set(relativePath, cached)
				return cached
			}

			// Ignore expects paths to be path.relative()'d
			const allowed = !this.ignoreInstance.ignores(relativePath)
			this.accessDecisionCache.set(relativePath, allowed)
			if (this.accessDecisionCache.size > MAX_ACCESS_DECISIONS) {
				const oldest = this.accessDecisionCache.keys().next().value
				if (oldest !== undefined) {
					this.accessDecisionCache.delete(oldest)
				}
			}
			return allowed
		} catch (_error) {
			// Logger.error(`Error validating access for ${filePath}:`, error)
			// Ignore is designed to work with relative file paths, so will throw error for paths outside cwd. We are allowing access to all files outside cwd.
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no .dietcodeignore exists
		if (!this.hasPolicyFile) {
			return undefined
		}

		// Split command into parts and get the base command
		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0].toLowerCase()

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				const arg = parts[i]
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Ignore PowerShell parameter names
				if (arg.includes(":")) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			Logger.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	async dispose(): Promise<void> {
		// Exclude any in-flight policy read from committing after disposal.
		this.reloadRequest++
		if (this.fileWatcher) {
			await this.fileWatcher.close()
			this.fileWatcher = undefined
		}
		this.activeIncludePaths.clear()
		this.accessDecisionCache.clear()
	}
}

function pathsEqual(left: string, right: string): boolean {
	const normalizedLeft = path.normalize(left)
	const normalizedRight = path.normalize(right)
	return process.platform === "win32"
		? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
		: normalizedLeft === normalizedRight
}
