import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { EventEmitter } from "events"
import getFolderSize from "get-folder-size"
import Mutex from "p-mutex"
import { findLastIndex } from "@/shared/array"
import { combineApiRequests } from "@/shared/combineApiRequests"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { CodemarieMessage } from "@/shared/ExtensionMessage"
import { getApiMetrics } from "@/shared/getApiMetrics"
import { HistoryItem } from "@/shared/HistoryItem"
import { CodemarieStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ensureTaskDirectoryExists, saveApiConversationHistory, saveCodemarieMessages } from "../storage/disk"
import { TaskState } from "./TaskState"

// Event types for codemarieMessages changes
export type CodemarieMessageChangeType = "add" | "update" | "delete" | "set"

export interface CodemarieMessageChange {
	type: CodemarieMessageChangeType
	/** The full array after the change */
	messages: CodemarieMessage[]
	/** The affected index (for add/update/delete) */
	index?: number
	/** The new/updated message (for add/update) */
	message?: CodemarieMessage
	/** The old message before change (for update/delete) */
	previousMessage?: CodemarieMessage
	/** The entire previous array (for set) */
	previousMessages?: CodemarieMessage[]
}

// Strongly-typed event emitter interface
export interface MessageStateHandlerEvents {
	codemarieMessagesChanged: [change: CodemarieMessageChange]
}

interface MessageStateHandlerParams {
	taskId: string
	ulid: string
	taskIsFavorited?: boolean
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	taskState: TaskState
	checkpointManagerErrorMessage?: string
}

export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private apiConversationHistory: CodemarieStorageMessage[] = []
	private codemarieMessages: CodemarieMessage[] = []
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState

	// Mutex to prevent concurrent state modifications (RC-4)
	// Protects against data loss from race conditions when multiple
	// operations try to modify message state simultaneously
	// This follows the same pattern as Task.stateMutex for consistency
	private stateMutex = new Mutex()

	constructor(params: MessageStateHandlerParams) {
		super()
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this.updateTaskHistory = params.updateTaskHistory
	}

	/**
	 * Emit a codemarieMessagesChanged event with the change details
	 */
	private emitCodemarieMessagesChanged(change: CodemarieMessageChange): void {
		this.emit("codemarieMessagesChanged", change)
	}

	setCheckpointTracker(tracker: CheckpointTracker | undefined) {
		this.checkpointTracker = tracker
	}

	/**
	 * Execute function with exclusive lock on message state
	 * Use this for ANY state modification to prevent race conditions
	 * This follows the same pattern as Task.withStateLock for consistency
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	getApiConversationHistory(): CodemarieStorageMessage[] {
		return this.apiConversationHistory
	}

	setApiConversationHistory(newHistory: CodemarieStorageMessage[]): void {
		this.apiConversationHistory = newHistory
	}

	getCodemarieMessages(): CodemarieMessage[] {
		return this.codemarieMessages
	}

	setCodemarieMessages(newMessages: CodemarieMessage[]) {
		const previousMessages = this.codemarieMessages
		this.codemarieMessages = newMessages
		this.emitCodemarieMessagesChanged({
			type: "set",
			messages: this.codemarieMessages,
			previousMessages,
		})
	}

	/**
	 * Internal method to save messages and update history (without mutex protection)
	 * This is used by methods that already hold the stateMutex lock
	 * Should NOT be called directly - use saveCodemarieMessagesAndUpdateHistory() instead
	 */
	private async saveCodemarieMessagesAndUpdateHistoryInternal(): Promise<void> {
		try {
			await saveCodemarieMessages(this.taskId, this.codemarieMessages)

			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.codemarieMessages.slice(1))))
			const taskMessage = this.codemarieMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.codemarieMessages[
					findLastIndex(
						this.codemarieMessages,
						(message) => !(message.ask === "resume_task" || message.ask === "resume_completed_task"),
					)
				]
			const lastModelInfo = [...this.apiConversationHistory].reverse().find((msg) => msg.modelInfo !== undefined)
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			let taskDirSize = 0
			try {
				// getFolderSize.loose silently ignores errors
				// returns # of bytes, size/1000/1000 = MB
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (error) {
				Logger.error("Failed to get task directory size:", taskDir, error)
			}
			const cwd = await getCwd(getDesktopDir())
			await this.updateTaskHistory({
				id: this.taskId,
				ulid: this.ulid,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
				size: taskDirSize,
				shadowGitConfigWorkTree: await this.checkpointTracker?.getShadowGitConfigWorkTree(),
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
				checkpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
				modelId: lastModelInfo?.modelInfo?.modelId,
			})
		} catch (error) {
			Logger.error("Failed to save codemarie messages:", error)
		}
	}

	/**
	 * Save codemarie messages and update task history (public API with mutex protection)
	 * This is the main entry point for saving message state from external callers
	 */
	async saveCodemarieMessagesAndUpdateHistory(): Promise<void> {
		return await this.withStateLock(async () => {
			await this.saveCodemarieMessagesAndUpdateHistoryInternal()
		})
	}

	async addToApiConversationHistory(message: CodemarieStorageMessage) {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			this.apiConversationHistory.push(message)
			await saveApiConversationHistory(this.taskId, this.apiConversationHistory)
		})
	}

	async overwriteApiConversationHistory(newHistory: CodemarieStorageMessage[]): Promise<void> {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			this.apiConversationHistory = newHistory
			await saveApiConversationHistory(this.taskId, this.apiConversationHistory)
		})
	}

	/**
	 * Add a new message to codemarieMessages array with proper index tracking
	 * CRITICAL: This entire operation must be atomic to prevent race conditions (RC-4)
	 * The conversationHistoryIndex must be set correctly based on the current state,
	 * and the message must be added and saved without any interleaving operations
	 */
	async addToCodemarieMessages(message: CodemarieMessage) {
		return await this.withStateLock(async () => {
			// these values allow us to reconstruct the conversation history at the time this codemarie message was created
			// it's important that apiConversationHistory is initialized before we add codemarie messages
			message.conversationHistoryIndex = this.apiConversationHistory.length - 1 // NOTE: this is the index of the last added message which is the user message, and once the codemariemessages have been presented we update the apiconversationhistory with the completed assistant message. This means when resetting to a message, we need to +1 this index to get the correct assistant message that this tool use corresponds to
			message.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange
			const index = this.codemarieMessages.length
			this.codemarieMessages.push(message)
			this.emitCodemarieMessagesChanged({
				type: "add",
				messages: this.codemarieMessages,
				index,
				message,
			})
			await this.saveCodemarieMessagesAndUpdateHistoryInternal()
		})
	}

	/**
	 * Replace the entire codemarieMessages array with new messages
	 * Protected by mutex to prevent concurrent modifications (RC-4)
	 */
	async overwriteCodemarieMessages(newMessages: CodemarieMessage[]) {
		return await this.withStateLock(async () => {
			const previousMessages = this.codemarieMessages
			this.codemarieMessages = newMessages
			this.emitCodemarieMessagesChanged({
				type: "set",
				messages: this.codemarieMessages,
				previousMessages,
			})
			await this.saveCodemarieMessagesAndUpdateHistoryInternal()
		})
	}

	/**
	 * Update a specific message in the codemarieMessages array
	 * The entire operation (validate, update, save) is atomic to prevent races (RC-4)
	 */
	async updateCodemarieMessage(index: number, updates: Partial<CodemarieMessage>): Promise<void> {
		return await this.withStateLock(async () => {
			if (index < 0 || index >= this.codemarieMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			// Capture previous state before mutation
			const previousMessage = { ...this.codemarieMessages[index] }

			// Apply updates to the message
			Object.assign(this.codemarieMessages[index], updates)

			this.emitCodemarieMessagesChanged({
				type: "update",
				messages: this.codemarieMessages,
				index,
				previousMessage,
				message: this.codemarieMessages[index],
			})

			// Save changes and update history
			await this.saveCodemarieMessagesAndUpdateHistoryInternal()
		})
	}

	/**
	 * Delete a specific message from the codemarieMessages array
	 * The entire operation (validate, delete, save) is atomic to prevent races (RC-4)
	 */
	async deleteCodemarieMessage(index: number): Promise<void> {
		return await this.withStateLock(async () => {
			if (index < 0 || index >= this.codemarieMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			// Capture the message before deletion
			const previousMessage = this.codemarieMessages[index]

			// Remove the message at the specified index
			this.codemarieMessages.splice(index, 1)

			this.emitCodemarieMessagesChanged({
				type: "delete",
				messages: this.codemarieMessages,
				index,
				previousMessage,
			})

			// Save changes and update history
			await this.saveCodemarieMessagesAndUpdateHistoryInternal()
		})
	}
}
