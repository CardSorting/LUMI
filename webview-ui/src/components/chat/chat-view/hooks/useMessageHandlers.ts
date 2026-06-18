import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/dietcode/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/dietcode/task"
import { useCallback, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import { resolveChatSendRoute } from "../shared/chatInputPolicy"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: DietCodeMessage[], chatState: ChatState): MessageHandlers {
	const { backgroundCommandRunning, currentTaskItem } = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setPendingQuote,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		dietcodeAsk,
		lastMessage,
	} = chatState
	const sendRouteOptions = useMemo(() => ({ taskSessionActive: Boolean(currentTaskItem?.id) }), [currentTaskItem?.id])

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			if (hasContent) {
				const sendRoute = resolveChatSendRoute(messages, dietcodeAsk, sendRouteOptions)
				console.log("[ChatView] handleSendMessage - route:", sendRoute, messageToSend)
				let messageSent = false

				if (sendRoute === "new_task") {
					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				} else if (sendRoute === "ask") {
					// For resume_task and resume_completed_task, use yesButtonClicked to match Resume button behavior
					// This ensures Enter key and Resume button work identically
					if (dietcodeAsk === "resume_task" || dietcodeAsk === "resume_completed_task") {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: messageToSend,
								images,
								files,
							}),
						)
						messageSent = true
					} else {
						// All other ask types use messageResponse
						switch (dietcodeAsk) {
							case "followup":
							case "plan_mode_respond":
							case "tool":
							case "browser_action_launch":
							case "command":
							case "command_output":
							case "use_mcp_server":
							case "use_subagents":
							case "completion_result":
							case "mistake_limit_reached":
							case "api_req_failed":
							case "new_task":
							case "condense":
							case "report_bug":
								await TaskServiceClient.askResponse(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: messageToSend,
										images,
										files,
									}),
								)
								messageSent = true
								break
						}
					}
				} else if (sendRoute === "follow_up") {
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "messageResponse",
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				} else {
					console.warn("[ChatView] Message not sent — no active send route", {
						dietcodeAsk,
						messageCount: messages.length,
					})
				}

				// Only clear input and disable UI if message was actually sent
				if (messageSent) {
					const isFollowUpMessage = sendRoute === "follow_up"
					setInputValue("")
					setActiveQuote(null)
					setPendingQuote(null)
					if (!isFollowUpMessage) {
						setSendingDisabled(true)
						setEnableButtons(false)
					}
					setSelectedImages([])
					setSelectedFiles([])

					// Reset auto-scroll
					if ("disableAutoScrollRef" in chatState) {
						;(chatState as any).disableAutoScrollRef.current = false
					}
				}
			}
		},
		[
			messages.length,
			dietcodeAsk,
			activeQuote,
			setInputValue,
			setActiveQuote,
			setPendingQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			chatState,
			messages,
			sendRouteOptions,
		],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		setPendingQuote(null)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote, setPendingQuote])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setPendingQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setPendingQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "yesButtonClicked",
						}),
					)
					clearInputState()
					break
				case "approve":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "reject":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "new_task":
					if (dietcodeAsk === "new_task") {
						await TaskServiceClient.newTask(
							NewTaskRequest.create({
								text: lastMessage?.text,
								images: [],
								files: [],
							}),
						)
					} else {
						await startNewTask()
					}
					break

				case "cancel": {
					if (cancelInFlightRef.current) {
						return
					}
					cancelInFlightRef.current = true
					setSendingDisabled(true)
					setEnableButtons(false)
					try {
						if (backgroundCommandRunning) {
							await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({})).catch((err) =>
								console.error("Failed to cancel background command:", err),
							)
						}
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					} finally {
						cancelInFlightRef.current = false
						// Clear any pending state that might interfere with resume
						setSendingDisabled(false)
						setEnableButtons(true)
					}
					break
				}

				case "utility":
					switch (dietcodeAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			dietcodeAsk,
			lastMessage,
			clearInputState,
			startNewTask,
			chatState,
			backgroundCommandRunning,
			setSendingDisabled,
			setEnableButtons,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
