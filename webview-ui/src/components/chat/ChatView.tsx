import { isAgentActiveForPlaceholder, isTaskInIdleGap } from "@shared/agentActivity"
import { buildUIGateEvaluationOptions } from "@shared/audit/auditGateUiOptions"
import { getAutoScrollAuditEventTs, getLatestAdvisorySnapshot, getLatestGateBlockSnapshot } from "@shared/audit/auditHistoryUtils"
import {
	getAuditTrend,
	getDisplayAuditSnapshotsFromMessages,
	getLatestGateAuditFromMessages,
	getLatestPlanAuditFromMessages,
	getPreviousGateAuditFromMessages,
} from "@shared/audit/auditMessages"
import { findAuditMessageIndex, findMessageIndexForAuditTs } from "@shared/audit/auditNavigation"
import { buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { computeAuditHealthSummaryWithBaseline } from "@shared/audit/auditRollup"
import { buildSubagentAuditSummary } from "@shared/audit/auditSubagentRollup"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { combineErrorRetryMessages } from "@shared/combineErrorRetryMessages"
import { combineHookSequences } from "@shared/combineHookSequences"
import { getApiMetrics, getLastApiReqTotalTokens } from "@shared/getApiMetrics"
import { BooleanRequest, StringRequest } from "@shared/proto/dietcode/common"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import { isChatInputEnabled } from "@/components/chat/chat-view/shared/chatInputPolicy"
import { normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShowNavbar } from "@/context/PlatformContext"
import { pickChatPlaceholder } from "@/copy/lumiVoice"
import { useAuditAutoScrollPolicy } from "@/hooks/useAuditAutoScrollPolicy"
import { useAuditGateConfig } from "@/hooks/useAuditGateConfig"
import { useLumiSessionComfort } from "@/hooks/useLumiSessionComfort"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { Navbar } from "../menu/Navbar"
import AutoApproveBar from "./auto-approve-menu/AutoApproveBar"
// Import utilities and hooks from the new structure
import {
	ActionButtons,
	CHAT_CONSTANTS,
	ChatLayout,
	convertHtmlToMarkdown,
	filterVisibleMessages,
	groupLowStakesTools,
	groupMessages,
	InputSection,
	MessagesArea,
	TaskSection,
	useChatState,
	useMessageHandlers,
	useScrollBehavior,
	WelcomeSection,
} from "./chat-view"

interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

// Use constants from the imported module
const MAX_IMAGES_AND_FILES_PER_MESSAGE = CHAT_CONSTANTS.MAX_IMAGES_AND_FILES_PER_MESSAGE

const ChatView = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }: ChatViewProps) => {
	const showNavbar = useShowNavbar()
	const {
		version,
		dietcodeMessages: messages,
		taskHistory,
		apiConfiguration,
		telemetrySetting,
		mode,
		currentFocusChainChecklist,
		focusChainSettings,
		hooksEnabled,
		isNewUser,
		currentTaskItem,
	} = useExtensionState()
	//const task = messages.length > 0 ? (messages[0].say === "task" ? messages[0] : undefined) : undefined) : undefined
	const task = useMemo(() => messages.at(0), [messages]) // leaving this less safe version here since if the first message is not a task, then the extension is in a bad state and needs to be debugged (see LUMI.abort)
	const modifiedMessages = useMemo(() => {
		const slicedMessages = messages.slice(1)
		// Only combine hook sequences if hooks are enabled
		const withHooks = hooksEnabled ? combineHookSequences(slicedMessages) : slicedMessages
		return combineErrorRetryMessages(combineApiRequests(combineCommandSequences(withHooks)))
	}, [messages, hooksEnabled])
	// has to be after api_req_finished are all reduced into api_req_started messages
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const lastApiReqTotalTokens = useMemo(() => getLastApiReqTotalTokens(modifiedMessages) || undefined, [modifiedMessages])

	const latestAuditMetadata = useMemo(() => getLatestGateAuditFromMessages(messages), [messages])
	const auditTrend = useMemo(() => {
		const previous = getPreviousGateAuditFromMessages(messages)
		return getAuditTrend(previous, latestAuditMetadata)
	}, [messages, latestAuditMetadata])
	const auditSnapshots = useMemo(() => getDisplayAuditSnapshotsFromMessages(messages), [messages])
	const planAuditBaseline = useMemo(() => getLatestPlanAuditFromMessages(messages), [messages])
	const auditHealth = useMemo(
		() => computeAuditHealthSummaryWithBaseline(auditSnapshots, planAuditBaseline),
		[auditSnapshots, planAuditBaseline],
	)
	const subagentAuditSummary = useMemo(() => buildSubagentAuditSummary(messages), [messages])
	const gateConfig = useAuditGateConfig()
	const auditAutoScrollPolicy = useAuditAutoScrollPolicy()
	const checklistSummary = useMemo(
		() =>
			buildPreCompletionChecklistSummary(
				latestAuditMetadata,
				buildUIGateEvaluationOptions(gateConfig, messages, latestAuditMetadata),
			),
		[latestAuditMetadata, gateConfig, messages],
	)

	// Use custom hooks for state management
	const chatState = useChatState(messages)
	const {
		setInputValue,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		sendingDisabled,
		enableButtons,
		expandedRows,
		setExpandedRows,
		textAreaRef,
	} = chatState

	const { sessionMinutes, isNightDesk, serenityLevel } = useLumiSessionComfort()

	useEffect(() => {
		const handleCopy = async (e: ClipboardEvent) => {
			const targetElement = e.target as HTMLElement | null
			// If the copy event originated from an input or textarea,
			// let the default browser behavior handle it.
			if (
				targetElement &&
				(targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA" || targetElement.isContentEditable)
			) {
				return
			}

			if (window.getSelection) {
				const selection = window.getSelection()
				if (selection && selection.rangeCount > 0) {
					const range = selection.getRangeAt(0)
					const commonAncestor = range.commonAncestorContainer
					let textToCopy: string | null = null

					// Check if the selection is inside an element where plain text copy is preferred
					let currentElement =
						commonAncestor.nodeType === Node.ELEMENT_NODE
							? (commonAncestor as HTMLElement)
							: commonAncestor.parentElement
					let preferPlainTextCopy = false
					while (currentElement) {
						if (currentElement.tagName === "PRE" && currentElement.querySelector("code")) {
							preferPlainTextCopy = true
							break
						}
						// Check computed white-space style
						const computedStyle = window.getComputedStyle(currentElement)
						if (
							computedStyle.whiteSpace === "pre" ||
							computedStyle.whiteSpace === "pre-wrap" ||
							computedStyle.whiteSpace === "pre-line"
						) {
							// If the element itself or an ancestor has pre-like white-space,
							// and the selection is likely contained within it, prefer plain text.
							// This helps with elements like the TaskHeader's text display.
							preferPlainTextCopy = true
							break
						}

						// Stop searching if we reach a known chat message boundary or body
						if (
							currentElement.classList.contains("chat-row-assistant-message-container") ||
							currentElement.classList.contains("chat-row-user-message-container") ||
							currentElement.tagName === "BODY"
						) {
							break
						}
						currentElement = currentElement.parentElement
					}

					if (preferPlainTextCopy) {
						// For code blocks or elements with pre-formatted white-space, get plain text.
						textToCopy = selection.toString()
					} else {
						// For other content, use the existing HTML-to-Markdown conversion
						const clonedSelection = range.cloneContents()
						const div = document.createElement("div")
						div.appendChild(clonedSelection)
						const selectedHtml = div.innerHTML
						textToCopy = await convertHtmlToMarkdown(selectedHtml)
					}

					if (textToCopy !== null) {
						try {
							FileServiceClient.copyToClipboard(StringRequest.create({ value: textToCopy })).catch((err) => {
								console.error("Error copying to clipboard:", err)
							})
							e.preventDefault()
						} catch (error) {
							console.error("Error copying to clipboard:", error)
						}
					}
				}
			}
		}
		document.addEventListener("copy", handleCopy)

		return () => {
			document.removeEventListener("copy", handleCopy)
		}
	}, [])
	// Button state is now managed by useButtonState hook

	// handleFocusChange is already provided by chatState

	// Use message handlers hook
	const messageHandlers = useMessageHandlers(messages, chatState)

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, mode)
	}, [apiConfiguration, mode])

	const selectFilesAndImages = useCallback(async () => {
		try {
			const response = await FileServiceClient.selectFiles(
				BooleanRequest.create({
					value: selectedModelInfo.supportsImages,
				}),
			)
			if (response?.values1 && response.values2 && (response.values1.length > 0 || response.values2.length > 0)) {
				const currentTotal = selectedImages.length + selectedFiles.length
				const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - currentTotal

				if (availableSlots > 0) {
					// Prioritize images first
					const imagesToAdd = Math.min(response.values1.length, availableSlots)
					if (imagesToAdd > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...response.values1.slice(0, imagesToAdd)])
					}

					// Use remaining slots for files
					const remainingSlots = availableSlots - imagesToAdd
					if (remainingSlots > 0) {
						setSelectedFiles((prevFiles) => [...prevFiles, ...response.values2.slice(0, remainingSlots)])
					}
				}
			}
		} catch (error) {
			console.error("Error selecting images & files:", error)
		}
	}, [selectedModelInfo.supportsImages, selectedFiles.length, selectedImages.length, setSelectedFiles, setSelectedImages])

	const shouldDisableFilesAndImages = selectedImages.length + selectedFiles.length >= MAX_IMAGES_AND_FILES_PER_MESSAGE

	// Subscribe to show webview events from the backend
	useEffect(() => {
		const cleanup = UiServiceClient.subscribeToShowWebview(
			{},
			{
				onResponse: (event) => {
					// Only focus if not hidden and preserveEditorFocus is false
					if (!isHidden && !event.preserveEditorFocus) {
						textAreaRef.current?.focus()
					}
				},
				onError: (error) => {
					console.error("Error in showWebview subscription:", error)
				},
				onComplete: () => {
					console.log("showWebview subscription completed")
				},
			},
		)

		return cleanup
	}, [isHidden, textAreaRef.current])

	// Set up addToInput subscription
	useEffect(() => {
		const cleanup = UiServiceClient.subscribeToAddToInput(
			{},
			{
				onResponse: (event) => {
					if (event.value) {
						setInputValue((prevValue) => {
							const newText = event.value
							const newTextWithNewline = `${newText}\n`
							return prevValue ? `${prevValue}\n${newTextWithNewline}` : newTextWithNewline
						})
						// Add scroll to bottom after state update
						// Auto focus the input and start the cursor on a new line for easy typing
						setTimeout(() => {
							if (textAreaRef.current) {
								textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight
								textAreaRef.current.focus()
							}
						}, 0)
					}
				},
				onError: (error) => {
					console.error("Error in addToInput subscription:", error)
				},
				onComplete: () => {
					console.log("addToInput subscription completed")
				},
			},
		)

		return cleanup
	}, [setInputValue, textAreaRef.current])

	useMount(() => {
		// NOTE: the vscode window needs to be focused for this to work
		textAreaRef.current?.focus()
	})

	const visibleMessages = useMemo(() => {
		return filterVisibleMessages(modifiedMessages)
	}, [modifiedMessages])

	const lastProgressMessageText = useMemo(() => {
		if (!focusChainSettings.enabled) {
			return undefined
		}

		// First check if we have a current focus chain list from the extension state
		if (currentFocusChainChecklist) {
			return currentFocusChainChecklist
		}

		// Fall back to the last task_progress message if no state focus chain list
		const lastProgressMessage = [...modifiedMessages].reverse().find((message) => message.say === "task_progress")
		return lastProgressMessage?.text
	}, [focusChainSettings.enabled, modifiedMessages, currentFocusChainChecklist])

	const showFocusChainPlaceholder = useMemo(() => {
		// Show placeholder whenever focus chain is enabled and no checklist exists yet.
		return focusChainSettings.enabled && !lastProgressMessageText
	}, [focusChainSettings.enabled, lastProgressMessageText])

	const groupedMessages = useMemo(() => {
		return groupLowStakesTools(groupMessages(visibleMessages))
	}, [visibleMessages])

	// Use scroll behavior hook
	const scrollBehavior = useScrollBehavior(messages, visibleMessages, groupedMessages, expandedRows, setExpandedRows)

	const handleScrollToAuditMessage = useCallback(
		(ts: number) => {
			const snapshot = auditSnapshots.find((entry) => entry.ts === ts)
			const index = snapshot ? findAuditMessageIndex(messages, snapshot) : findMessageIndexForAuditTs(messages, ts)
			if (index >= 0) {
				scrollBehavior.scrollToMessage(index)
			}
		},
		[messages, auditSnapshots, scrollBehavior.scrollToMessage],
	)

	const previousAuditSnapshotCountRef = useRef(auditSnapshots.length)
	const [auditLiveAnnouncement, setAuditLiveAnnouncement] = useState("")
	useEffect(() => {
		const scrollTs = getAutoScrollAuditEventTs(auditSnapshots, previousAuditSnapshotCountRef.current, auditAutoScrollPolicy)
		if (scrollTs !== undefined) {
			const snapshot = auditSnapshots.find((entry) => entry.ts === scrollTs)
			if (snapshot) {
				setAuditLiveAnnouncement(buildAuditEventLiveAnnouncement(snapshot))
			}
			handleScrollToAuditMessage(scrollTs)
		}
		previousAuditSnapshotCountRef.current = auditSnapshots.length
	}, [auditSnapshots, auditAutoScrollPolicy, handleScrollToAuditMessage])

	const handleScrollToLatestGateBlock = useCallback(() => {
		const latest = getLatestGateBlockSnapshot(auditSnapshots)
		if (latest) {
			handleScrollToAuditMessage(latest.ts)
		}
	}, [auditSnapshots, handleScrollToAuditMessage])

	const handleScrollToLatestAdvisory = useCallback(() => {
		const latest = getLatestAdvisorySnapshot(auditSnapshots)
		if (latest) {
			handleScrollToAuditMessage(latest.ts)
		}
	}, [auditSnapshots, handleScrollToAuditMessage])

	const taskSessionActive = Boolean(currentTaskItem?.id)

	const chatInputEnabled = useMemo(
		() => isChatInputEnabled(messages, chatState.dietcodeAsk, { sendingDisabled }, { taskSessionActive }),
		[messages, chatState.dietcodeAsk, sendingDisabled, taskSessionActive],
	)

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && chatInputEnabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, chatInputEnabled, enableButtons, textAreaRef.current])

	const placeholderText = useMemo(() => {
		const seed = task?.ts ?? 0
		const agentActive = isAgentActiveForPlaceholder(messages, chatState.dietcodeAsk)
		const idleGap = isTaskInIdleGap(messages, chatState.dietcodeAsk)
		return pickChatPlaceholder(Boolean(task), seed, sessionMinutes, isNightDesk, agentActive, idleGap)
	}, [task, sessionMinutes, isNightDesk, messages, chatState.dietcodeAsk])

	return (
		<ChatLayout isHidden={isHidden} isNightDesk={isNightDesk} serenityLevel={serenityLevel}>
			<div aria-atomic="true" aria-live="polite" className="sr-only">
				{auditLiveAnnouncement}
			</div>
			<div className="flex flex-col flex-1 overflow-hidden">
				{showNavbar && <Navbar />}
				{task ? (
					<TaskSection
						apiMetrics={apiMetrics}
						auditHealth={auditHealth}
						auditSnapshots={auditSnapshots}
						auditTrend={auditTrend}
						checklistSummary={checklistSummary}
						lastApiReqTotalTokens={lastApiReqTotalTokens}
						lastProgressMessageText={lastProgressMessageText}
						latestAuditMetadata={latestAuditMetadata}
						messageHandlers={messageHandlers}
						onScrollToAuditMessage={handleScrollToAuditMessage}
						onScrollToLatestAdvisory={handleScrollToLatestAdvisory}
						onScrollToLatestGateBlock={handleScrollToLatestGateBlock}
						selectedModelInfo={{
							supportsPromptCache: selectedModelInfo.supportsPromptCache,
							supportsImages: selectedModelInfo.supportsImages || false,
						}}
						showFocusChainPlaceholder={showFocusChainPlaceholder}
						subagentAuditSummary={subagentAuditSummary}
						task={task}
					/>
				) : !isNewUser ? (
					<WelcomeSection
						hideAnnouncement={hideAnnouncement}
						showAnnouncement={showAnnouncement}
						showHistoryView={showHistoryView}
						taskHistory={taskHistory}
						telemetrySetting={telemetrySetting}
						version={version}
					/>
				) : null}
				{task && (
					<MessagesArea
						chatState={chatState}
						groupedMessages={groupedMessages}
						messageHandlers={messageHandlers}
						modifiedMessages={modifiedMessages}
						scrollBehavior={scrollBehavior}
						task={task}
					/>
				)}
			</div>
			<footer className="bg-background" style={{ gridRow: "2" }}>
				<AutoApproveBar />
				<ActionButtons
					chatState={chatState}
					messageHandlers={messageHandlers}
					messages={messages}
					mode={mode}
					scrollBehavior={{
						scrollToBottomSmooth: scrollBehavior.scrollToBottomSmooth,
						disableAutoScrollRef: scrollBehavior.disableAutoScrollRef,
						showScrollToBottom: scrollBehavior.showScrollToBottom,
						virtuosoRef: scrollBehavior.virtuosoRef,
					}}
					task={task}
				/>
				<InputSection
					chatState={chatState}
					messageHandlers={messageHandlers}
					messages={messages}
					placeholderText={placeholderText}
					scrollBehavior={scrollBehavior}
					selectFilesAndImages={selectFilesAndImages}
					shouldDisableFilesAndImages={shouldDisableFilesAndImages}
					taskSessionActive={taskSessionActive}
				/>
			</footer>
		</ChatLayout>
	)
}

export default ChatView
