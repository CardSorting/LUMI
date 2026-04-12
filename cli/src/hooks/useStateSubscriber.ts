/**
 * Custom hook to subscribe to controller state updates
 * Handles the diff/merge logic for streaming text and message tracking
 */

import type { CodemarieMessage } from "@shared/ExtensionMessage"
import { useCallback, useRef } from "react"
import { useTaskContext } from "../context/TaskContext"

interface ProcessedState {
	processedAskMessages: Set<number>
	processedSayMessages: Set<number>
}

/**
 * Hook to track which ask/say messages have been processed
 * This prevents duplicate prompts for the same ask message
 */
export const useProcessedMessages = () => {
	const processedRef = useRef<ProcessedState>({
		processedAskMessages: new Set(),
		processedSayMessages: new Set(),
	})

	return processedRef.current
}

/**
 * Detect if a message has just been completed (is asking for user input)
 */
export const useCompletedAskMessages = () => {
	const { state } = useTaskContext()
	const processed = useProcessedMessages()

	const getCompletedAskMessages = useCallback(() => {
		const completedAsks: CodemarieMessage[] = []

		if (!state.codemarieMessages) {
			return completedAsks
		}

		for (let i = 0; i < state.codemarieMessages.length; i++) {
			const message = state.codemarieMessages[i]
			if (message.type === "ask" && !message.partial && !processed.processedAskMessages.has(i)) {
				completedAsks.push(message)
				processed.processedAskMessages.add(i)
			}
		}

		return completedAsks
	}, [state.codemarieMessages, processed])

	return getCompletedAskMessages
}

/**
 * Get the last completed ask message (for rendering current input prompt)
 */
export const useLastCompletedAskMessage = () => {
	const { state } = useTaskContext()
	const _processed = useProcessedMessages()

	const getLastCompletedAskMessage = useCallback((): CodemarieMessage | null => {
		if (!state.codemarieMessages) {
			return null
		}

		// Find the last ask message that is complete
		for (let i = state.codemarieMessages.length - 1; i >= 0; i--) {
			const message = state.codemarieMessages[i]
			if (message.type === "ask" && !message.partial) {
				return message
			}
		}

		return null
	}, [state.codemarieMessages])

	return getLastCompletedAskMessage()
}

/**
 * Get messages that should trigger the completion detection
 */
export const useCompletionSignals = () => {
	const { state } = useTaskContext()

	const isTaskComplete = useCallback((): boolean => {
		if (!state.codemarieMessages || state.codemarieMessages.length === 0) {
			return false
		}

		const lastMessage = state.codemarieMessages[state.codemarieMessages.length - 1]
		if (!lastMessage) {
			return false
		}

		// Check for completion signals
		if (lastMessage.say === "completion_result" || lastMessage.ask === "completion_result") {
			return true
		}

		// Check for error signals
		if (lastMessage.say === "error" || lastMessage.ask === "api_req_failed") {
			return true
		}

		return false
	}, [state.codemarieMessages])

	const getCompletionMessage = useCallback((): CodemarieMessage | null => {
		if (!state.codemarieMessages || state.codemarieMessages.length === 0) {
			return null
		}

		return state.codemarieMessages[state.codemarieMessages.length - 1] || null
	}, [state.codemarieMessages])

	return {
		isTaskComplete,
		getCompletionMessage,
	}
}

/**
 * Check if spinner should be shown (when API is thinking)
 * Returns an object with isActive flag and startTime timestamp
 */
export const useIsSpinnerActive = (): { isActive: boolean; startTime?: number } => {
	const { state } = useTaskContext()

	if (!state.codemarieMessages || state.codemarieMessages.length === 0) {
		return { isActive: false }
	}

	// If the last message is a completed ask message, don't show spinner (waiting for user input)
	const lastMessage = state.codemarieMessages[state.codemarieMessages.length - 1]
	if (lastMessage?.type === "ask" && !lastMessage.partial) {
		return { isActive: false }
	}

	// Look for most recent api_req_started that isn't followed by api_req_finished
	for (let i = state.codemarieMessages.length - 1; i >= 0; i--) {
		const msg = state.codemarieMessages[i]
		if (msg.say === "api_req_started") {
			// Check if there's an api_req_finished after this
			let hasFinished = false
			for (let j = i + 1; j < state.codemarieMessages.length; j++) {
				if (state.codemarieMessages[j].say === "api_req_finished") {
					hasFinished = true
					break
				}
			}
			if (!hasFinished) {
				return { isActive: true, startTime: msg.ts }
			}
			return { isActive: false }
		}
	}

	return { isActive: false }
}
