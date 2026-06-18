import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ButtonActionType, getApprovalPromptLabel, getButtonConfig } from "../../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: DietCodeMessage
	messages: DietCodeMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
}

/**
 * Approval / action buttons when the agent needs user confirmation.
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({ task, messages, chatState, mode, messageHandlers }) => {
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled } = chatState
	const [isProcessing, setIsProcessing] = useState(false)

	// Memoize last messages to avoid unnecessary recalculations
	const [lastMessage, secondLastMessage] = useMemo(() => {
		const len = messages.length
		return len > 0 ? [messages[len - 1], messages[len - 2]] : [undefined, undefined]
	}, [messages])

	// Memoize button configuration to avoid recalculation on every render
	const buttonConfig = useMemo(() => {
		return lastMessage ? getButtonConfig(lastMessage, mode) : { sendingDisabled: false, enableButtons: false }
	}, [lastMessage, mode])

	// Single effect to handle all configuration updates
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		setIsProcessing(false)
	}, [buttonConfig, setSendingDisabled])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage?.type, lastMessage?.say, secondLastMessage?.ask, chatState])

	const handleActionClick = useCallback(
		(action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (isProcessing) {
				return
			}
			setIsProcessing(true)

			void messageHandlers.executeButtonAction(action, text, images, files).catch(() => {
				// Reset processing state on errors to avoid getting stuck.
				setIsProcessing(false)
			})
		},
		[messageHandlers, isProcessing],
	)

	// Keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				handleActionClick("cancel")
			}
		},
		[handleActionClick],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	if (!task) {
		return null
	}

	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = Boolean(primaryText || secondaryText)
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessing
	const promptLabel = getApprovalPromptLabel(lastMessage, buttonConfig)

	if (!hasButtons) {
		return null
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex flex-col px-3 gap-1.5 pb-1" style={{ opacity }}>
			{promptLabel ? <p className="text-[11px] text-muted-foreground m-0 pt-1.5">{promptLabel}</p> : null}
			{primaryText && primaryAction && (
				<VSCodeButton
					appearance="primary"
					className="rounded-lg w-full"
					disabled={!canInteract}
					onClick={() => handleActionClick(primaryAction, inputValue, selectedImages, selectedFiles)}>
					{primaryText}
				</VSCodeButton>
			)}
			{secondaryText && secondaryAction && (
				<VSCodeButton
					appearance="secondary"
					className="rounded-lg w-full"
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}>
					{secondaryText}
				</VSCodeButton>
			)}
		</div>
	)
}
