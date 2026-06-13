/**
 * MULTI-ROOT CHECKPOINT MANAGER - Phase 1 Complete
 *
 * This MultiRootCheckpointManager class is the multi-workspace checkpoint
 * implementation for the multi-root workspace support initiative.
 *
 * Current Status:
 * - Infrastructure is complete: init, save, restore, diff, commit
 * - The feature flag for multi-root is disabled by default
 * - The checkpoint factory (src/integrations/checkpoints/factory.ts) will
 *   instantiate this manager when multi-root is enabled
 *
 * Activation Steps:
 * 1. Enable the multi-root feature flag in StateManager
 * 2. The checkpoint factory will automatically use this manager
 * 3. All workspace roots will be tracked independently with parallel commits
 *
 * See PRD: Multi-Workspace Folder Support for complete requirements
 */

import { ContextManager } from "@core/context/context-management/ContextManager"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { MessageStateHandler } from "@core/task/message-state"
import type { TaskState } from "@core/task/TaskState"
import { WorkspaceRootManager } from "@core/workspace"
import { telemetryService } from "@services/telemetry"
import { findLast, findLastIndex } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import type { DietCodeApiReqInfo, DietCodeMessage, DietCodeSay } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import type { DietCodeCheckpointRestore } from "@shared/WebviewMessage"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import CheckpointTracker from "./CheckpointTracker"
import { ICheckpointManager } from "./types"

type SayFunction = (
	type: DietCodeSay,
	text?: string,
	images?: string[],
	files?: string[],
	partial?: boolean,
) => Promise<number | undefined>

type ChangedFile = {
	relativePath: string
	absolutePath: string
	before: string
	after: string
}

type CommitSummary = {
	rootHashes: Map<string, string>
	primaryHash?: string
	successCount: number
	failureCount: number
}

type KnowledgeGraphServiceLike = {
	addKnowledge(taskId: string, type: string, content: string, options?: Record<string, unknown>): Promise<unknown>
}

type MultiRootCheckpointCallbacks = {
	say?: SayFunction
	getKnowledgeGraphService?: () => Promise<KnowledgeGraphServiceLike | null | undefined>
}

/**
 * Manages checkpoints across multiple workspace roots.
 * Only created when multiple roots are detected and feature flag is enabled.
 *
 * This implementation follows Option B: Simple All-Workspace Approach
 * - Creates checkpoints instance for each input workspace root
 * - Commits run in parallel in the background (non-blocking)
 * - Maintains backward compatibility with single-root expectations
 */
export class MultiRootCheckpointManager implements ICheckpointManager {
	private trackers: Map<string, CheckpointTracker> = new Map()
	private lastCommitHashes: Map<string, string> = new Map()
	private firstCommitHashes: Map<string, string> = new Map()
	private messageCommitHashes: Map<number, Map<string, string>> = new Map()
	private currentCompletionCommitHashes: Map<string, string> = new Map()
	private previousCompletionCommitHashes: Map<string, string> = new Map()
	private initialized = false
	private initPromise?: Promise<void>

	constructor(
		private workspaceManager: WorkspaceRootManager,
		private taskId: string,
		private enableCheckpoints: boolean,
		private messageStateHandler: MessageStateHandler,
		private taskState?: TaskState,
		private callbacks: MultiRootCheckpointCallbacks = {},
	) {}

	/**
	 * Initialize checkpoint trackers for all workspace roots
	 * This is called separately to avoid blocking the Task constructor
	 */
	async initialize(): Promise<void> {
		// Prevent multiple initialization attempts
		if (this.initialized) {
			return
		}

		if (this.initPromise) {
			return this.initPromise
		}

		this.initPromise = this.doInitialize()
		await this.initPromise
		this.initPromise = undefined
	}

	private async doInitialize(): Promise<void> {
		if (!this.enableCheckpoints) {
			Logger.log("[MultiRootCheckpointManager] Checkpoints disabled, skipping initialization")
			return
		}

		const startTime = performance.now()
		const roots = this.workspaceManager.getRoots()
		Logger.log(`[MultiRootCheckpointManager] Initializing for ${roots.length} workspace roots`)

		// Initialize all workspace roots in parallel
		const initPromises = roots.map(async (root) => {
			try {
				Logger.log(`[MultiRootCheckpointManager] Creating tracker for ${root.name} at ${root.path}`)
				const tracker = await CheckpointTracker.create(this.taskId, this.enableCheckpoints, root.path)
				if (tracker) {
					this.trackers.set(root.path, tracker)
					Logger.log(`[MultiRootCheckpointManager] Successfully initialized tracker for ${root.name}`)
					return true
				}
				return false
			} catch (error) {
				Logger.error(`[MultiRootCheckpointManager] Failed to initialize checkpoint for ${root.name}:`, error)
				// Continue with other roots even if one fails
				return false
			}
		})

		const results = await Promise.all(initPromises)
		const successCount = results.filter((r) => r).length
		const failureCount = results.length - successCount

		this.initialized = true
		Logger.log(`[MultiRootCheckpointManager] Initialization complete. Active trackers: ${this.trackers.size}`)

		// TELEMETRY: Track multi-root checkpoint initialization
		telemetryService.captureMultiRootCheckpoint(
			this.taskId,
			"initialized",
			roots.length,
			successCount,
			failureCount,
			performance.now() - startTime,
		)
	}

	private getRootName(rootPath: string): string {
		const root = this.workspaceManager.getRoots().find((candidate) => candidate.path === rootPath)
		return root?.name || rootPath
	}

	private getPrimaryRootPath(): string | undefined {
		return this.workspaceManager.getPrimaryRoot()?.path
	}

	private getPrimaryHash(rootHashes: Map<string, string>): string | undefined {
		const primaryRootPath = this.getPrimaryRootPath()
		return primaryRootPath ? rootHashes.get(primaryRootPath) : Array.from(rootHashes.values())[0]
	}

	private recordCommitSummary(summary: CommitSummary, messageTs?: number, isCompletion = false): void {
		for (const [rootPath, hash] of summary.rootHashes.entries()) {
			this.lastCommitHashes.set(rootPath, hash)
			if (!this.firstCommitHashes.has(rootPath)) {
				this.firstCommitHashes.set(rootPath, hash)
			}
		}

		if (messageTs) {
			this.messageCommitHashes.set(messageTs, new Map(summary.rootHashes))
		}

		if (isCompletion) {
			this.previousCompletionCommitHashes = new Map(this.currentCompletionCommitHashes)
			this.currentCompletionCommitHashes = new Map(summary.rootHashes)
		}
	}

	private inferPendingCheckpointMessageTs(): number | undefined {
		const messages = this.messageStateHandler.getDietCodeMessages()
		const lastCheckpointIndex = findLastIndex(
			messages,
			(message) => message.say === "checkpoint_created" && !message.lastCheckpointHash,
		)
		return lastCheckpointIndex === -1 ? undefined : messages[lastCheckpointIndex].ts
	}

	private getRootHashesForMessage(message: DietCodeMessage): Map<string, string> {
		const mapped = this.messageCommitHashes.get(message.ts)
		if (mapped) {
			return new Map(mapped)
		}

		const fallback = new Map<string, string>()
		const primaryRootPath = this.getPrimaryRootPath()
		if (primaryRootPath && message.lastCheckpointHash) {
			fallback.set(primaryRootPath, message.lastCheckpointHash)
		}
		return fallback
	}

	private async commitAllRoots(): Promise<CommitSummary> {
		if (!this.initialized) {
			await this.initialize()
		}

		if (!this.initialized || this.trackers.size === 0) {
			return { rootHashes: new Map(), successCount: 0, failureCount: 0 }
		}

		const results = await Promise.all(
			Array.from(this.trackers.entries()).map(async ([rootPath, tracker]) => {
				try {
					const hash = await tracker.commit()
					if (!hash) {
						return { rootPath, hash: undefined, success: false }
					}
					Logger.log(`[MultiRootCheckpointManager] Checkpoint created for ${this.getRootName(rootPath)}: ${hash}`)
					return { rootPath, hash, success: true }
				} catch (error) {
					Logger.error(`[MultiRootCheckpointManager] Failed to checkpoint ${this.getRootName(rootPath)}:`, error)
					return { rootPath, hash: undefined, success: false }
				}
			}),
		)

		const rootHashes = new Map<string, string>()
		for (const result of results) {
			if (result.success && result.hash) {
				rootHashes.set(result.rootPath, result.hash)
			}
		}

		return {
			rootHashes,
			primaryHash: this.getPrimaryHash(rootHashes),
			successCount: rootHashes.size,
			failureCount: results.length - rootHashes.size,
		}
	}

	private async captureCheckpointMirror(summary: CommitSummary, label: string, tags: string[]): Promise<void> {
		try {
			const kgService = await this.callbacks.getKnowledgeGraphService?.()
			if (!kgService || !summary.primaryHash) return

			const fileCounts = await Promise.all(
				Array.from(summary.rootHashes.entries()).map(async ([rootPath, hash]) => {
					const tracker = this.trackers.get(rootPath)
					const count = tracker ? await tracker.getDiffCount(hash) : 0
					return `${this.getRootName(rootPath)}: ${count || 0}`
				}),
			)

			await kgService.addKnowledge(
				this.taskId,
				"snapshot:mirror",
				`${label}: ${summary.primaryHash}\nWorkspace Checkpoints:\n${fileCounts.join("\n")}`,
				{
					tags,
					metadata: {
						commitHash: summary.primaryHash,
						rootCount: summary.rootHashes.size,
						rootHashes: Object.fromEntries(summary.rootHashes),
					},
				},
			)
		} catch (error) {
			Logger.error("[MultiRootCheckpointManager] Failed to mirror checkpoint metadata:", error)
		}
	}

	/**
	 * Save checkpoint across all workspace roots
	 * Commits happen in parallel in the background (non-blocking)
	 */
	async saveCheckpoint(isAttemptCompletionMessage = false, completionMessageTs?: number): Promise<void> {
		if (!this.enableCheckpoints || !this.initialized) {
			return
		}

		if (this.trackers.size === 0) {
			Logger.log("[MultiRootCheckpointManager] No trackers available for checkpoint")
			return
		}

		Logger.log(`[MultiRootCheckpointManager] Creating checkpoint across ${this.trackers.size} workspace(s)`)

		const startTime = performance.now()
		if (isAttemptCompletionMessage) {
			const summary = await this.commitAllRoots()
			this.recordCommitSummary(summary, completionMessageTs, true)

			if (completionMessageTs && summary.primaryHash) {
				const messageIndex = this.messageStateHandler
					.getDietCodeMessages()
					.findIndex((message) => message.ts === completionMessageTs)
				if (messageIndex !== -1) {
					await this.messageStateHandler.updateDietCodeMessage(messageIndex, {
						lastCheckpointHash: summary.primaryHash,
					})
				}
			}

			await this.captureCheckpointMirror(summary, "Final Multi-Root Checkpoint Created", [
				"git_checkpoint",
				"mirror",
				"completion",
				"multi_root",
			])

			telemetryService.captureMultiRootCheckpoint(
				this.taskId,
				"committed",
				this.trackers.size,
				summary.successCount,
				summary.failureCount,
				performance.now() - startTime,
			)
			return
		}

		if (!this.callbacks.say) {
			this.commitAllRoots()
				.then((summary) => {
					this.recordCommitSummary(summary, undefined, false)
					Logger.log(
						`[MultiRootCheckpointManager] Checkpoint complete: ${summary.successCount}/${this.trackers.size} successful`,
					)
					telemetryService.captureMultiRootCheckpoint(
						this.taskId,
						"committed",
						this.trackers.size,
						summary.successCount,
						summary.failureCount,
						performance.now() - startTime,
					)
				})
				.catch((error) => {
					Logger.error("[MultiRootCheckpointManager] Unexpected error during checkpoint:", error)
				})
			return
		}

		const dietcodeMessages = this.messageStateHandler.getDietCodeMessages()
		const lastMessage = dietcodeMessages.at(-1)
		if (lastMessage?.say === "checkpoint_created") {
			return
		}

		const messageTs = await this.callbacks.say("checkpoint_created")
		this.commitAllRoots()
			.then(async (summary) => {
				this.recordCommitSummary(summary, messageTs, false)
				if (messageTs && summary.primaryHash) {
					const messageIndex = this.messageStateHandler
						.getDietCodeMessages()
						.findIndex((message) => message.ts === messageTs)
					if (messageIndex !== -1) {
						await this.messageStateHandler.updateDietCodeMessage(messageIndex, {
							lastCheckpointHash: summary.primaryHash,
						})
					}
				}

				await this.captureCheckpointMirror(summary, "Multi-Root Checkpoint Created", [
					"git_checkpoint",
					"mirror",
					"multi_root",
				])

				telemetryService.captureMultiRootCheckpoint(
					this.taskId,
					"committed",
					this.trackers.size,
					summary.successCount,
					summary.failureCount,
					performance.now() - startTime,
				)
			})
			.catch((error) => {
				Logger.error("[MultiRootCheckpointManager] Unexpected error during checkpoint:", error)
			})
	}

	/**
	 * Restore checkpoint for all tracked workspace roots.
	 * Iterates each root and restores it to the last committed checkpoint.
	 * Returns a summary of which roots were restored successfully.
	 */
	async restoreCheckpoint(
		messageTs: number,
		restoreType: DietCodeCheckpointRestore,
		offset?: number,
	): Promise<{ restoredRoots: string[]; failedRoots: string[]; error?: string }> {
		if (!this.initialized || this.trackers.size === 0) {
			Logger.error("[MultiRootCheckpointManager] No trackers available for restore")
			return { restoredRoots: [], failedRoots: [], error: "No checkpoint trackers initialized" }
		}

		const dietcodeMessages = this.messageStateHandler.getDietCodeMessages()
		const messageIndex = dietcodeMessages.findIndex((message) => message.ts === messageTs) - (offset || 0)
		const message = dietcodeMessages[messageIndex]
		const lastHashIndex = findLastIndex(
			dietcodeMessages.slice(0, messageIndex),
			(candidate) => candidate.lastCheckpointHash !== undefined,
		)
		const fallbackMessage = dietcodeMessages[lastHashIndex]

		if (!message) {
			const error = `Message not found for timestamp ${messageTs}`
			Logger.error(`[MultiRootCheckpointManager] ${error}`)
			HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: "Failed to restore checkpoint" })
			return { restoredRoots: [], failedRoots: [], error }
		}

		let didWorkspaceRestoreFail = false
		let restoredRoots: string[] = []
		let failedRoots: string[] = []

		if (restoreType === "workspace" || restoreType === "taskAndWorkspace") {
			const targetMessage =
				message.lastCheckpointHash || !fallbackMessage
					? message
					: offset || !message.lastCheckpointHash
						? fallbackMessage
						: message
			const rootHashes = this.getRootHashesForMessage(targetMessage)

			if (rootHashes.size === 0) {
				const error = "Failed to restore checkpoint: No valid checkpoint hash found"
				Logger.error(`[MultiRootCheckpointManager] ${error}`)
				HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: error })
				return { restoredRoots: [], failedRoots: [], error }
			}

			const restoreResult = await this.restoreWorkspaceRoots(rootHashes)
			restoredRoots = restoreResult.restoredRoots
			failedRoots = restoreResult.failedRoots
			didWorkspaceRestoreFail = failedRoots.length > 0
		}

		if (!didWorkspaceRestoreFail && (restoreType === "task" || restoreType === "taskAndWorkspace")) {
			await this.restoreTaskHistory(message, messageIndex, messageTs)
		}

		Logger.log(
			`[MultiRootCheckpointManager] Restore complete: ${restoredRoots.length} restored, ${failedRoots.length} failed`,
		)

		if (!didWorkspaceRestoreFail) {
			const message =
				restoreType === "task"
					? "Task messages have been restored to the checkpoint"
					: restoreType === "workspace"
						? "Workspace files have been restored to the checkpoint"
						: "Task and workspace have been restored to the checkpoint"
			HostProvider.window.showMessage({ type: ShowMessageType.INFORMATION, message })
		}

		telemetryService.captureMultiRootCheckpoint(
			this.taskId,
			"restored",
			this.trackers.size,
			restoredRoots.length,
			failedRoots.length,
		)

		return {
			restoredRoots,
			failedRoots,
			error: failedRoots.length > 0 ? `Failed to restore: ${failedRoots.join(", ")}` : undefined,
		}
	}

	private async restoreWorkspaceRoots(
		rootHashes: Map<string, string>,
	): Promise<{ restoredRoots: string[]; failedRoots: string[] }> {
		const restoredRoots: string[] = []
		const failedRoots: string[] = []

		await Promise.all(
			Array.from(this.trackers.entries()).map(async ([rootPath, tracker]) => {
				const rootName = this.getRootName(rootPath)
				const commitHash = rootHashes.get(rootPath)

				if (!commitHash) {
					Logger.warn(`[MultiRootCheckpointManager] No checkpoint hash recorded for ${rootName}, skipping restore`)
					failedRoots.push(rootName)
					return
				}

				try {
					Logger.log(`[MultiRootCheckpointManager] Restoring checkpoint for ${rootName}`)
					await tracker.resetHead(commitHash)
					restoredRoots.push(rootName)
					Logger.log(`[MultiRootCheckpointManager] Successfully restored ${rootName}`)
				} catch (error) {
					Logger.error(`[MultiRootCheckpointManager] Failed to restore ${rootName}:`, error)
					failedRoots.push(rootName)
				}
			}),
		)

		if (failedRoots.length > 0) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to restore checkpoint for: ${failedRoots.join(", ")}`,
			})
		}

		return { restoredRoots, failedRoots }
	}

	private async restoreTaskHistory(message: DietCodeMessage, messageIndex: number, messageTs: number): Promise<void> {
		if (!this.taskState) {
			Logger.warn("[MultiRootCheckpointManager] Task state unavailable; skipped task history restore")
			return
		}

		this.taskState.conversationHistoryDeletedRange = message.conversationHistoryDeletedRange

		const apiConversationHistory = this.messageStateHandler.getApiConversationHistory()
		const newConversationHistory = apiConversationHistory.slice(0, (message.conversationHistoryIndex || 0) + 2)
		await this.messageStateHandler.overwriteApiConversationHistory(newConversationHistory)

		const contextManager = new ContextManager()
		await contextManager.truncateContextHistory(messageTs, await ensureTaskDirectoryExists(this.taskId))

		const dietcodeMessages = this.messageStateHandler.getDietCodeMessages()
		const deletedMessages = dietcodeMessages.slice(messageIndex + 1)
		const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))
		const newDietCodeMessages = dietcodeMessages.slice(0, messageIndex + 1)
		await this.messageStateHandler.overwriteDietCodeMessages(newDietCodeMessages)

		await this.callbacks.say?.(
			"deleted_api_reqs",
			JSON.stringify({
				tokensIn: deletedApiReqsMetrics.totalTokensIn,
				tokensOut: deletedApiReqsMetrics.totalTokensOut,
				cacheWrites: deletedApiReqsMetrics.totalCacheWrites,
				cacheReads: deletedApiReqsMetrics.totalCacheReads,
				cost: deletedApiReqsMetrics.totalCost,
			} satisfies DietCodeApiReqInfo),
		)
	}

	/**
	 * Check if the latest task completion has new changes
	 * Returns true if ANY workspace has changes
	 */
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		if (!this.initialized || this.trackers.size === 0) {
			return false
		}

		const dietcodeMessages = this.messageStateHandler.getDietCodeMessages()
		const messageIndex = findLastIndex(dietcodeMessages, (message) => message.say === "completion_result")
		const message = dietcodeMessages[messageIndex]
		if (!message?.lastCheckpointHash) {
			Logger.error(`[MultiRootCheckpointManager] No completion checkpoint hash found for task ${this.taskId}`)
			return false
		}

		const currentHashes =
			this.messageCommitHashes.get(message.ts) ||
			(this.currentCompletionCommitHashes.size > 0
				? this.currentCompletionCommitHashes
				: this.getRootHashesForMessage(message))

		const previousCompletionMessage = findLast(
			dietcodeMessages.slice(0, messageIndex),
			(candidate) => candidate.say === "completion_result" && !!candidate.lastCheckpointHash,
		)
		const firstCheckpointMessage = dietcodeMessages.find(
			(candidate) => candidate.say === "checkpoint_created" && !!candidate.lastCheckpointHash,
		)

		let previousHashes = this.previousCompletionCommitHashes
		if (previousHashes.size === 0 && previousCompletionMessage) {
			previousHashes = this.getRootHashesForMessage(previousCompletionMessage)
		}
		if (previousHashes.size === 0 && firstCheckpointMessage) {
			previousHashes = this.getRootHashesForMessage(firstCheckpointMessage)
		}
		if (previousHashes.size === 0) {
			previousHashes = this.firstCommitHashes
		}

		if (previousHashes.size === 0 || currentHashes.size === 0) {
			Logger.error(`[MultiRootCheckpointManager] Missing checkpoint baseline for task ${this.taskId}`)
			return false
		}

		for (const [rootPath, tracker] of this.trackers.entries()) {
			try {
				const previousHash = previousHashes.get(rootPath)
				const currentHash = currentHashes.get(rootPath)
				if (!previousHash || !currentHash || previousHash === currentHash) {
					continue
				}

				const diffCount = await tracker.getDiffCount(previousHash, currentHash)
				if (diffCount > 0) {
					Logger.log(
						`[MultiRootCheckpointManager] Changes detected in ${this.getRootName(rootPath)}: ${diffCount} file(s)`,
					)
					return true
				}
			} catch (error) {
				Logger.error(`[MultiRootCheckpointManager] Error checking changes for ${rootPath}:`, error)
			}
		}

		return false
	}

	/**
	 * Commit changes across all workspaces
	 * Returns the primary root's commit hash for backward compatibility
	 */
	async commit(): Promise<string | undefined> {
		if (!this.initialized || this.trackers.size === 0) {
			return undefined
		}

		const summary = await this.commitAllRoots()
		const messageTs = this.inferPendingCheckpointMessageTs()
		this.recordCommitSummary(summary, messageTs, false)
		return summary.primaryHash
	}

	/**
	 * Presents a multi-file diff view for all workspace roots with a known checkpoint baseline.
	 */
	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		try {
			if (!this.enableCheckpoints || !this.initialized) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Checkpoint manager is not initialized.",
				})
				return
			}

			const dietcodeMessages = this.messageStateHandler.getDietCodeMessages()
			const messageIndex = dietcodeMessages.findIndex((message) => message.ts === messageTs)
			const message = dietcodeMessages[messageIndex]
			if (!message?.lastCheckpointHash) {
				Logger.error("[MultiRootCheckpointManager] Message checkpoint hash not found")
				HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message: "No checkpoint hash found" })
				return
			}

			const changedFiles = seeNewChangesSinceLastTaskCompletion
				? await this.getChangesSinceLastTaskCompletion(messageIndex, message)
				: await this.getChangesSinceSnapshot(message)

			if (!changedFiles.length) {
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "No changes found",
				})
				return
			}

			const title = seeNewChangesSinceLastTaskCompletion ? "New changes" : "Changes since snapshot"
			await HostProvider.diff.openMultiFileDiff({
				title,
				diffs: changedFiles.map((file) => ({
					filePath: file.absolutePath,
					leftContent: file.before,
					rightContent: file.after,
				})),
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			Logger.error("[MultiRootCheckpointManager] Failed to present multifile diff:", errorMessage)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to present diff: ${errorMessage}`,
			})
		}
	}

	private async getChangesSinceSnapshot(message: DietCodeMessage): Promise<ChangedFile[]> {
		const rootHashes = this.getRootHashesForMessage(message)
		return this.getDiffsFromRootHashes(rootHashes)
	}

	private async getChangesSinceLastTaskCompletion(messageIndex: number, message: DietCodeMessage): Promise<ChangedFile[]> {
		const currentHashes = this.getRootHashesForMessage(message)
		const dietcodeMessages = this.messageStateHandler.getDietCodeMessages()
		const previousCompletionMessage = findLast(
			dietcodeMessages.slice(0, messageIndex),
			(candidate) => candidate.say === "completion_result" && !!candidate.lastCheckpointHash,
		)
		const firstCheckpointMessage = dietcodeMessages.find(
			(candidate) => candidate.say === "checkpoint_created" && !!candidate.lastCheckpointHash,
		)
		const previousHashes = previousCompletionMessage
			? this.getRootHashesForMessage(previousCompletionMessage)
			: firstCheckpointMessage
				? this.getRootHashesForMessage(firstCheckpointMessage)
				: this.firstCommitHashes

		if (previousHashes.size === 0) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Unexpected error: No checkpoint hash found",
			})
			return []
		}

		return this.getDiffsBetweenRootHashes(previousHashes, currentHashes)
	}

	private async getDiffsFromRootHashes(rootHashes: Map<string, string>): Promise<ChangedFile[]> {
		const changedFiles: ChangedFile[] = []
		const skippedRoots: string[] = []

		await Promise.all(
			Array.from(this.trackers.entries()).map(async ([rootPath, tracker]) => {
				const hash = rootHashes.get(rootPath)
				if (!hash) {
					skippedRoots.push(this.getRootName(rootPath))
					return
				}
				const diffSet = await tracker.getDiffSet(hash)
				changedFiles.push(...diffSet)
			}),
		)

		if (skippedRoots.length > 0) {
			HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message: `Diff omitted workspace(s) without checkpoint data: ${skippedRoots.join(", ")}`,
			})
		}

		return changedFiles
	}

	private async getDiffsBetweenRootHashes(
		previousHashes: Map<string, string>,
		currentHashes: Map<string, string>,
	): Promise<ChangedFile[]> {
		const changedFiles: ChangedFile[] = []
		const skippedRoots: string[] = []

		await Promise.all(
			Array.from(this.trackers.entries()).map(async ([rootPath, tracker]) => {
				const previousHash = previousHashes.get(rootPath)
				const currentHash = currentHashes.get(rootPath)
				if (!previousHash || !currentHash) {
					skippedRoots.push(this.getRootName(rootPath))
					return
				}
				if (previousHash === currentHash) {
					return
				}
				const diffSet = await tracker.getDiffSet(previousHash, currentHash)
				changedFiles.push(...diffSet)
			}),
		)

		if (skippedRoots.length > 0) {
			HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message: `Diff omitted workspace(s) without checkpoint data: ${skippedRoots.join(", ")}`,
			})
		}

		return changedFiles
	}
}
