import { BROWSER_VIEWPORT_PRESETS } from "@shared/BrowserSettings"
import { BrowserAction, BrowserActionResult, DietCodeMessage, DietCodeSayBrowserAction } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/dietcode/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import { ChevronRightIcon } from "lucide-react"
import React, { CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import { BrowserSettingsMenu } from "@/components/browser/BrowserSettingsMenu"
import { ChatRowContent, ProgressIndicator } from "@/components/chat/ChatRow"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { APPROVAL } from "@/copy/lumiVoice"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface BrowserSessionRowProps {
	messages: DietCodeMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (messageTs: number) => void
	lastModifiedMessage?: DietCodeMessage
	isLast: boolean
	onHeightChange: (isTaller: boolean) => void
	onPendingQuoteChange: (text: string | null) => void
}

const browserSessionRowContainerInnerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "10px",
	marginBottom: "10px",
}
const browserIconStyle: CSSProperties = {
	color: "var(--vscode-foreground)",
	marginBottom: "-1.5px",
}
const urlBarContainerStyle: CSSProperties = {
	margin: "5px auto",
	width: "calc(100% - 10px)",
	display: "flex",
	alignItems: "center",
	gap: "4px",
}
const imgScreenshotStyle: CSSProperties = {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
	objectFit: "contain",
	cursor: "pointer",
}
const noScreenshotContainerStyle: CSSProperties = {
	position: "absolute",
	top: "50%",
	left: "50%",
	transform: "translate(-50%, -50%)",
}
const noScreenshotIconStyle: CSSProperties = {
	fontSize: "80px",
	color: "var(--vscode-descriptionForeground)",
}
const paginationContainerStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "8px 0px",
	marginTop: "15px",
	borderTop: "1px solid var(--vscode-editorGroup-border)",
}
const paginationButtonGroupStyle: CSSProperties = { display: "flex", gap: "4px" }
const codeBlockContainerStyle: CSSProperties = {
	borderRadius: 3,
	border: "1px solid var(--vscode-editorGroup-border)",
	overflow: "hidden",
	backgroundColor: CODE_BLOCK_BG_COLOR,
}
const chatRowContentContainerStyle: CSSProperties = { padding: "10px 0 10px 0" }

const BrowserSessionRow = memo((props: BrowserSessionRowProps) => {
	const { messages, isLast, onHeightChange, lastModifiedMessage } = props
	const { browserSettings } = useExtensionState()
	const prevHeightRef = useRef(0)
	const [maxActionHeight, setMaxActionHeight] = useState(0)

	const isLastApiReqInterrupted = useMemo(() => {
		// Check if last api_req_started is cancelled
		const lastApiReqStarted = [...messages].reverse().find((m) => m.say === "api_req_started")
		if (lastApiReqStarted?.text != null) {
			const info = JSON.parse(lastApiReqStarted.text)
			if (info.cancelReason != null) {
				return true
			}
		}
		const lastApiReqFailed = isLast && lastModifiedMessage?.ask === "api_req_failed"
		if (lastApiReqFailed) {
			return true
		}
		return false
	}, [messages, lastModifiedMessage, isLast])

	// If last message is a resume, it means the task was cancelled and the browser was closed
	const isLastMessageResume = useMemo(() => {
		// Check if last message is resume completion
		return lastModifiedMessage?.ask === "resume_task" || lastModifiedMessage?.ask === "resume_completed_task"
	}, [lastModifiedMessage?.ask])

	const isBrowsing = useMemo(() => {
		return isLast && messages.some((m) => m.say === "browser_action_result") && !isLastApiReqInterrupted // after user approves, browser_action_result with "" is sent to indicate that the session has started
	}, [isLast, messages, isLastApiReqInterrupted])

	// Organize messages into pages with current state and next action
	const pages = useMemo(() => {
		const result: {
			currentState: {
				url?: string
				screenshot?: string
				mousePosition?: string
				consoleLogs?: string
				messages: DietCodeMessage[] // messages up to and including the result
			}
			nextAction?: {
				messages: DietCodeMessage[] // messages leading to next result
			}
		}[] = []

		let currentStateMessages: DietCodeMessage[] = []
		let nextActionMessages: DietCodeMessage[] = []

		messages.forEach((message) => {
			if (message.ask === "browser_action_launch" || message.say === "browser_action_launch") {
				// Start first page
				currentStateMessages = [message]
			} else if (message.say === "browser_action_result") {
				if (message.text === "") {
					// first browser_action_result is an empty string that signals that session has started
					return
				}
				// Complete current state
				currentStateMessages.push(message)
				const resultData = JSON.parse(message.text || "{}") as BrowserActionResult

				// Add page with current state and previous next actions
				result.push({
					currentState: {
						url: resultData.currentUrl,
						screenshot: resultData.screenshot,
						mousePosition: resultData.currentMousePosition,
						consoleLogs: resultData.logs,
						messages: [...currentStateMessages],
					},
					nextAction:
						nextActionMessages.length > 0
							? {
									messages: [...nextActionMessages],
								}
							: undefined,
				})

				// Reset for next page
				currentStateMessages = []
				nextActionMessages = []
			} else if (
				message.say === "api_req_started" ||
				message.say === "text" ||
				message.say === "reasoning" ||
				message.say === "browser_action" ||
				message.say === "error_retry"
			) {
				// These messages lead to the next result, so they should always go in nextActionMessages
				nextActionMessages.push(message)
			} else {
				// Any other message types
				currentStateMessages.push(message)
			}
		})

		// Add incomplete page if exists
		if (currentStateMessages.length > 0 || nextActionMessages.length > 0) {
			result.push({
				currentState: {
					messages: [...currentStateMessages],
				},
				nextAction:
					nextActionMessages.length > 0
						? {
								messages: [...nextActionMessages],
							}
						: undefined,
			})
		}

		return result
	}, [messages])

	// Auto-advance to latest page
	const [currentPageIndex, setCurrentPageIndex] = useState(0)
	useEffect(() => {
		setCurrentPageIndex(pages.length - 1)
	}, [pages.length])

	// Get initial URL from launch message
	const initialUrl = useMemo(() => {
		const launchMessage = messages.find((m) => m.ask === "browser_action_launch" || m.say === "browser_action_launch")
		return launchMessage?.text || ""
	}, [messages])

	const isAutoApproved = useMemo(() => {
		const launchMessage = messages.find((m) => m.ask === "browser_action_launch" || m.say === "browser_action_launch")
		return launchMessage?.say === "browser_action_launch"
	}, [messages])

	// const lastCheckpointMessageTs = useMemo(() => {
	// 	const lastCheckpointMessage = findLast(messages, (m) => m.lastCheckpointHash !== undefined)
	// 	return lastCheckpointMessage?.ts
	// }, [messages])

	// Find the latest available URL and screenshot
	const latestState = useMemo(() => {
		for (let i = pages.length - 1; i >= 0; i--) {
			const page = pages[i]
			if (page.currentState.url || page.currentState.screenshot) {
				return {
					url: page.currentState.url,
					mousePosition: page.currentState.mousePosition,
					consoleLogs: page.currentState.consoleLogs,
					screenshot: page.currentState.screenshot,
				}
			}
		}
		return {
			url: undefined,
			mousePosition: undefined,
			consoleLogs: undefined,
			screenshot: undefined,
		}
	}, [pages])

	const currentPage = pages[currentPageIndex]
	const isLastPage = currentPageIndex === pages.length - 1

	const defaultMousePosition = `${browserSettings.viewport.width * 0.7},${browserSettings.viewport.height * 0.5}`

	// Use latest state if we're on the last page and don't have a state yet
	const displayState = isLastPage
		? {
				url: currentPage?.currentState.url || latestState.url || initialUrl,
				mousePosition: currentPage?.currentState.mousePosition || latestState.mousePosition || defaultMousePosition,
				consoleLogs: currentPage?.currentState.consoleLogs,
				screenshot: currentPage?.currentState.screenshot || latestState.screenshot,
			}
		: {
				url: currentPage?.currentState.url || initialUrl,
				mousePosition: currentPage?.currentState.mousePosition || defaultMousePosition,
				consoleLogs: currentPage?.currentState.consoleLogs,
				screenshot: currentPage?.currentState.screenshot,
			}

	const [actionContent, { height: actionHeight }] = useSize(
		<div>
			{currentPage?.nextAction?.messages.map((message) => (
				<BrowserSessionRowContent
					expandedRows={props.expandedRows}
					isLast={props.isLast}
					key={message.ts}
					lastModifiedMessage={props.lastModifiedMessage}
					message={message}
					onPendingQuoteChange={props.onPendingQuoteChange}
					onToggleExpand={props.onToggleExpand}
					setMaxActionHeight={setMaxActionHeight}
				/>
			))}
			{!isBrowsing && messages.some((m) => m.say === "browser_action_result") && currentPageIndex === 0 && (
				<BrowserActionBox action={"launch"} text={initialUrl} />
			)}
		</div>,
	)

	useEffect(() => {
		if (actionHeight === 0 || actionHeight === Number.POSITIVE_INFINITY) {
			return
		}
		if (actionHeight > maxActionHeight) {
			setMaxActionHeight(actionHeight)
		}
	}, [actionHeight, maxActionHeight])

	// Track latest click coordinate
	const latestClickPosition = useMemo(() => {
		if (!isBrowsing) {
			return undefined
		}

		// Look through current page's next actions for the latest browser_action
		const actions = currentPage?.nextAction?.messages || []
		for (let i = actions.length - 1; i >= 0; i--) {
			const message = actions[i]
			if (message.say === "browser_action") {
				const browserAction = JSON.parse(message.text || "{}") as DietCodeSayBrowserAction
				if (browserAction.action === "click" && browserAction.coordinate) {
					return browserAction.coordinate
				}
			}
		}
		return undefined
	}, [isBrowsing, currentPage?.nextAction?.messages])

	// Use latest click position while browsing, otherwise use display state
	const mousePosition = isBrowsing ? latestClickPosition || displayState.mousePosition : displayState.mousePosition

	// let shouldShowCheckpoints = true
	// if (isLast) {
	// 	shouldShowCheckpoints = lastModifiedMessage?.ask === "resume_completed_task" || lastModifiedMessage?.ask === "resume_task"
	// }

	const _shouldShowSettings = useMemo(() => {
		const lastMessage = messages[messages.length - 1]
		return lastMessage?.ask === "browser_action_launch" || lastMessage?.say === "browser_action_launch"
	}, [messages])

	// Calculate maxWidth
	const maxWidth = browserSettings.viewport.width < BROWSER_VIEWPORT_PRESETS["Small Desktop (900x600)"].width ? 200 : undefined

	const [browserSessionRow, { height }] = useSize(
		// We don't declare a constant for the inline style here because `useSize` will try to modify the style object
		// Which will cause `Uncaught TypeError: Cannot assign to read only property 'position' of object '#<Object>'`
		<div className="py-2.5 pl-4 pr-1.5 relative -mb-2.5">
			<div style={browserSessionRowContainerInnerStyle}>
				{isBrowsing && !isLastMessageResume ? (
					<ProgressIndicator />
				) : (
					<VscIcon className="" name="inspect" style={browserIconStyle} />
				)}
				<span className="text-xs font-medium">{isAutoApproved ? "Browsing" : APPROVAL.browser}</span>
			</div>
			<div
				style={{
					borderRadius: 3,
					border: "1px solid var(--vscode-editorGroup-border)",
					// overflow: "hidden",
					backgroundColor: CODE_BLOCK_BG_COLOR,
					// marginBottom: 10,
					maxWidth,
					margin: "0 auto 10px auto", // Center the container
				}}>
				{/* URL Bar */}
				<div style={urlBarContainerStyle}>
					<div
						className={cn(
							"flex bg-input-background border border-input-border rounded-sm px-1 py-0.5 min-w-0 text-description w-full justify-center",
							{
								"text-input-foreground": !!displayState.url,
							},
						)}>
						<span className="text-xs text-ellipsis overflow-hidden whitespace-nowrap">
							{displayState.url || "http"}
						</span>
					</div>
					<BrowserSettingsMenu />
				</div>

				{/* Screenshot Area */}
				<div
					style={{
						width: "100%",
						paddingBottom: `${(browserSettings.viewport.height / browserSettings.viewport.width) * 100}%`,
						position: "relative",
						backgroundColor: "var(--vscode-input-background)",
					}}>
					{displayState.screenshot ? (
						<img
							alt="Browser screenshot"
							onClick={() =>
								FileServiceClient.openImage(StringRequest.create({ value: displayState.screenshot })).catch(
									(err) => console.error("Failed to open image:", err),
								)
							}
							src={displayState.screenshot}
							style={imgScreenshotStyle}
						/>
					) : (
						<div style={noScreenshotContainerStyle}>
							<VscIcon className="" name="globe" style={noScreenshotIconStyle} />
						</div>
					)}
					{displayState.mousePosition && (
						<BrowserCursor
							style={{
								position: "absolute",
								top: `${(Number.parseInt(mousePosition.split(",")[1], 10) / browserSettings.viewport.height) * 100}%`,
								left: `${(Number.parseInt(mousePosition.split(",")[0], 10) / browserSettings.viewport.width) * 100}%`,
								transition: "top 0.3s ease-out, left 0.3s ease-out",
							}}
						/>
					)}
				</div>

				<div className="border-t border-editor-group-border">
					<details className="lumi-inline-disclosure group">
						<summary className="lumi-details-trigger list-none cursor-pointer flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground">
							<ChevronRightIcon
								aria-hidden
								className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
							/>
							Browser console
						</summary>
						<CodeBlock source={`${"```"}shell\n${displayState.consoleLogs || "(No new logs)"}\n${"```"}`} />
					</details>
				</div>
			</div>

			{/* Action content with min height */}
			<div style={{ minHeight: maxActionHeight }}>{actionContent}</div>

			{/* Pagination moved to bottom */}
			{pages.length > 1 && (
				<div style={paginationContainerStyle}>
					<div>
						Step {currentPageIndex + 1} of {pages.length}
					</div>
					<div style={paginationButtonGroupStyle}>
						<VSCodeButton
							disabled={currentPageIndex === 0 || isBrowsing}
							onClick={() => setCurrentPageIndex((i) => i - 1)}>
							Previous
						</VSCodeButton>
						<VSCodeButton
							disabled={currentPageIndex === pages.length - 1 || isBrowsing}
							onClick={() => setCurrentPageIndex((i) => i + 1)}>
							Next
						</VSCodeButton>
					</div>
				</div>
			)}

			{/* {shouldShowCheckpoints && <CheckpointOverlay messageTs={lastCheckpointMessageTs} />} */}
		</div>,
	)

	// Height change effect
	useEffect(() => {
		const isInitialRender = prevHeightRef.current === 0
		if (isLast && height !== 0 && height !== Number.POSITIVE_INFINITY && height !== prevHeightRef.current) {
			if (!isInitialRender) {
				onHeightChange(height > prevHeightRef.current)
			}
			prevHeightRef.current = height
		}
	}, [height, isLast, onHeightChange])

	return browserSessionRow
}, deepEqual)

interface BrowserSessionRowContentProps extends Omit<BrowserSessionRowProps, "messages" | "onHeightChange"> {
	message: DietCodeMessage
	setMaxActionHeight: (height: number) => void
	onPendingQuoteChange: (text: string | null) => void
}

const BrowserSessionRowContent = memo(
	({
		message,
		expandedRows,
		onToggleExpand,
		lastModifiedMessage,
		isLast,
		setMaxActionHeight,
		onPendingQuoteChange,
	}: BrowserSessionRowContentProps) => {
		const handleToggle = useCallback(() => {
			if (message.say === "api_req_started") {
				setMaxActionHeight(0)
			}
			onToggleExpand(message.ts)
		}, [onToggleExpand, message.ts, setMaxActionHeight, message.say])

		if (message.ask === "browser_action_launch" || message.say === "browser_action_launch") {
			return (
				<>
					<div className="flex items-center gap-2.5 mb-2.5">
						<span className="text-xs font-medium">Opening browser</span>
					</div>
					<div style={codeBlockContainerStyle}>
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${message.text}\n${"```"}`} />
					</div>
				</>
			)
		}

		switch (message.type) {
			case "say":
				switch (message.say) {
					case "api_req_started":
					case "text":
					case "reasoning":
					case "error_retry":
						return (
							<div style={chatRowContentContainerStyle}>
								<ChatRowContent
									isExpanded={expandedRows[message.ts] ?? false}
									isLast={isLast}
									lastModifiedMessage={lastModifiedMessage}
									message={message}
									onPendingQuoteChange={onPendingQuoteChange}
									onToggleExpand={handleToggle}
								/>
							</div>
						)

					case "browser_action":
						const browserAction = JSON.parse(message.text || "{}") as DietCodeSayBrowserAction
						return (
							<BrowserActionBox
								action={browserAction.action}
								coordinate={browserAction.coordinate}
								text={browserAction.text}
							/>
						)

					default:
						return null
				}

			case "ask":
				switch (message.ask) {
					default:
						return null
				}
		}
	},
	deepEqual,
)

const BrowserActionBox = ({ action, coordinate, text }: { action: BrowserAction; coordinate?: string; text?: string }) => {
	const getBrowserActionText = (action: BrowserAction, coordinate?: string, text?: string) => {
		switch (action) {
			case "launch":
				return `Launch browser at ${text}`
			case "click":
				return `Click (${coordinate?.replace(",", ", ")})`
			case "type":
				return `Type "${text}"`
			case "scroll_down":
				return "Scroll down"
			case "scroll_up":
				return "Scroll up"
			case "close":
				return "Close browser"
			default:
				return action
		}
	}
	return (
		<div className="pt-2.5">
			<div className="rounded-sm border border-editor-group-border overflow-hidden bg-code">
				<div className="flex items-center px-2.5 py-2 text-xs">
					<span className="text-muted-foreground mr-1">Action:</span>
					<span className="font-medium break-words">{getBrowserActionText(action, coordinate, text)}</span>
				</div>
			</div>
		</div>
	)
}

const BrowserCursor: React.FC<{ style?: CSSProperties }> = ({ style }) => {
	// (can't use svgs in vsc extensions)
	const cursorBase64 =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAYCAYAAAAVibZIAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAFaADAAQAAAABAAAAGAAAAADwi9a/AAADGElEQVQ4EZ2VbUiTURTH772be/PxZdsz3cZwC4RVaB8SAjMpxQwSWZbQG/TFkN7oW1Df+h6IRV9C+hCpKUSIZUXOfGM5tAKViijFFEyfZ7Ol29S1Pbdzl8Uw9+aBu91zzv3/nt17zt2DEZjBYOAkKrtFMXIghAWM8U2vMN/FctsxGRMpM7NbEEYNMM2CYUSInlJx3OpawO9i+XSNQYkmk2uFb9njzkcfVSr1p/GJiQKMULVaw2WuBv296UKRxWJR6wxGCmM1EAhSNppv33GBH9qI32cPTAtss9lUm6EM3N7R+RbigT+5/CeosFCZKpjEW+iorS1pb30wDUXzQfHqtD/9L3ieZ2ee1OJCmbL8QHnRs+4uj0wmW4QzrpCwvJ8zGg3JqAmhTLynuLiwv8/5KyND8Q3cEkUEDWu15oJE4KRQJt5hs1rcriGNRqP+DK4dyyWXXm/aFQ+cEpSJ8/LyDGPuEZNOmzsOroUSOqzXG/dtBU4ZysTZYKNut91sNo2Cq6cE9enz86s2g9OCMrFSqVC5hgb32u072W3jKMU90Hb1seC0oUwsB+t92bO/rKx0EFGkgFCnjjc1/gVvC8rE0L+4o63t4InjxwbAJQjTe3qD8QrLkXA4DC24fWtuajp06cLFYSBIFKGmXKPRRmAnME9sPt+yLwIWb9WN69fKoTneQz4Dh2mpPNkvfeV0jjecb9wNAkwIEVQq5VJOds4Kb+DXoAsiVquVwI1Dougpij6UyGYx+5cKroeDEFibm5lWRRMbH1+npmYrq6qhwlQHIbajZEf1fElcqGGFpGg9HMuKzpfBjhytCTMgkJ56RX09zy/ysENTBElmjIgJnmNChJqohDVQqpEfwkILE8v/o0GAnV9F1eEvofVQCbiTBEXOIPQh5PGgefDZeAcjrpGZjULBr/m3tZOnz7oEQWRAQZLjWlEU/XEJWySiILgRc5Cz1DkcAyuBFcnpfF0JiXWKpcolQXizhS5hKAqFpr0MVbgbuxJ6+5xX+P4wNpbqPPrugZfbmIbLmgQR3Aw8QSi66hUXulOFbF73GxqjE5BNXWNeAAAAAElFTkSuQmCC"

	return (
		<img
			alt="cursor"
			src={cursorBase64}
			style={{
				width: "17px",
				height: "22px",
				...style,
			}}
		/>
	)
}

export default BrowserSessionRow
