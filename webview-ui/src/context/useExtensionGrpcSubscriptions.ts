import { findLastIndex } from "@shared/array"
import { projectMessageForWebview, projectMessagesForWebview } from "@shared/diagnostics/webviewDiagnostics"
import type { ExtensionState } from "@shared/ExtensionMessage"
import { DEFAULT_STALE_AFTER_MS } from "@shared/grpc/persistent-stream"
import { EmptyRequest } from "@shared/proto/dietcode/common"
import type { McpServers, McpMarketplaceCatalog as ProtoMcpMarketplaceCatalog } from "@shared/proto/dietcode/mcp"
import type { OpenRouterCompatibleModelInfo } from "@shared/proto/dietcode/models"
import type { State, TerminalProfile } from "@shared/proto/dietcode/state"
import type { DietCodeMessage } from "@shared/proto/dietcode/ui"
import { convertProtoToDietCodeMessage } from "@shared/proto-conversions/dietcode-message"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { useEffect } from "react"
import { useGrpcSubscription } from "@/hooks/useGrpcSubscription"
import { McpServiceClient, ModelsServiceClient, StateServiceClient, UiServiceClient } from "@/services/grpc-client"
import type { ModelInfo } from "../../../src/shared/api"
import { openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../../src/shared/api"
import type { McpMarketplaceCatalog, McpServer } from "../../../src/shared/mcp"

const EMPTY_REQUEST = EmptyRequest.create({})
const EMPTY_UI_REQUEST = {}

export interface ExtensionGrpcSubscriptionsParams {
	setState: Dispatch<SetStateAction<ExtensionState>>
	setDidHydrateState: (value: boolean) => void
	setShowWelcome: (value: boolean) => void
	setMcpServers: (value: McpServer[]) => void
	setMcpMarketplaceCatalog: (value: McpMarketplaceCatalog) => void
	setOpenRouterModels: (value: Record<string, ModelInfo>) => void
	setLiteLlmModels: (value: Record<string, ModelInfo>) => void
	setAvailableTerminalProfiles: (value: TerminalProfile[]) => void
	relinquishControlCallbacks: MutableRefObject<Set<() => void>>
	navigateToMcp: () => void
	navigateToHistory: () => void
	navigateToChat: () => void
	navigateToSettings: () => void
	navigateToWorktrees: () => void
	navigateToAccount: () => void
}

/** Declarative, auto-reconnecting extension subscriptions — transport owned by GrpcSubscriptionRuntime. */
export function useExtensionGrpcSubscriptions(params: ExtensionGrpcSubscriptionsParams): void {
	const {
		setState,
		setDidHydrateState,
		setShowWelcome,
		setMcpServers,
		setMcpMarketplaceCatalog,
		setOpenRouterModels,
		setLiteLlmModels,
		setAvailableTerminalProfiles,
		relinquishControlCallbacks,
		navigateToMcp,
		navigateToHistory,
		navigateToChat,
		navigateToSettings,
		navigateToWorktrees,
		navigateToAccount,
	} = params

	useGrpcSubscription<typeof EMPTY_REQUEST, State>({
		key: "state",
		debugLabel: "Extension State",
		subscribe: StateServiceClient.subscribeToState.bind(StateServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: DEFAULT_STALE_AFTER_MS,
		onMessage: (response) => {
			if (!response.stateJson) return
			try {
				const stateData = JSON.parse(response.stateJson) as ExtensionState
				stateData.dietcodeMessages = projectMessagesForWebview(stateData.dietcodeMessages ?? [], {
					showInternalDiagnostics: stateData.showInternalDiagnostics === true,
				})
				setState((prevState) => {
					const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
					const currentVersion = prevState.autoApprovalSettings?.version ?? 1
					const shouldUpdateAutoApproval = incomingVersion > currentVersion
					if (stateData.currentTaskItem?.id === prevState.currentTaskItem?.id) {
						stateData.dietcodeMessages = stateData.dietcodeMessages?.length
							? stateData.dietcodeMessages
							: prevState.dietcodeMessages
					}
					setShowWelcome(false)
					setDidHydrateState(true)
					return {
						...stateData,
						autoApprovalSettings: shouldUpdateAutoApproval
							? stateData.autoApprovalSettings
							: prevState.autoApprovalSettings,
					}
				})
			} catch (error) {
				console.error("Error parsing state JSON:", error)
			}
		},
	})

	useGrpcSubscription<typeof EMPTY_REQUEST, DietCodeMessage>({
		key: "partialMessage",
		debugLabel: "Partial Messages",
		subscribe: UiServiceClient.subscribeToPartialMessage.bind(UiServiceClient),
		request: EMPTY_REQUEST,
		onMessage: (protoMessage) => {
			try {
				if (!protoMessage.ts || protoMessage.ts <= 0) return
				const incomingPartialMessage = convertProtoToDietCodeMessage(protoMessage)
				setState((prevState) => {
					const partialMessage = projectMessageForWebview(incomingPartialMessage, {
						showInternalDiagnostics: prevState.showInternalDiagnostics === true,
					})
					const lastIndex = findLastIndex(prevState.dietcodeMessages, (msg) => msg.ts === partialMessage.ts)
					if (lastIndex === -1) return prevState
					const newDietCodeMessages = [...prevState.dietcodeMessages]
					newDietCodeMessages[lastIndex] = partialMessage
					return { ...prevState, dietcodeMessages: newDietCodeMessages }
				})
			} catch (error) {
				console.error("Failed to process partial message:", error, protoMessage)
			}
		},
	})

	useGrpcSubscription<typeof EMPTY_REQUEST, McpServers>({
		key: "mcpServers",
		debugLabel: "MCP Servers",
		subscribe: McpServiceClient.subscribeToMcpServers.bind(McpServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: DEFAULT_STALE_AFTER_MS,
		onMessage: (response) => {
			if (response.mcpServers) {
				setMcpServers(convertProtoMcpServersToMcpServers(response.mcpServers))
			}
		},
	})

	useGrpcSubscription<typeof EMPTY_REQUEST, ProtoMcpMarketplaceCatalog>({
		key: "mcpMarketplaceCatalog",
		debugLabel: "MCP Marketplace",
		subscribe: McpServiceClient.subscribeToMcpMarketplaceCatalog.bind(McpServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: DEFAULT_STALE_AFTER_MS,
		onMessage: (catalog) => setMcpMarketplaceCatalog(catalog),
	})

	useGrpcSubscription<typeof EMPTY_REQUEST, OpenRouterCompatibleModelInfo>({
		key: "openRouterModels",
		debugLabel: "OpenRouter Models",
		subscribe: ModelsServiceClient.subscribeToOpenRouterModels.bind(ModelsServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: DEFAULT_STALE_AFTER_MS,
		onMessage: (response) => {
			setOpenRouterModels({
				[openRouterDefaultModelId]: openRouterDefaultModelInfo,
				...fromProtobufModels(response.models),
			})
		},
	})

	useGrpcSubscription<typeof EMPTY_REQUEST, OpenRouterCompatibleModelInfo>({
		key: "liteLlmModels",
		debugLabel: "LiteLLM Models",
		subscribe: ModelsServiceClient.subscribeToLiteLlmModels.bind(ModelsServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: DEFAULT_STALE_AFTER_MS,
		onMessage: (response) => setLiteLlmModels(fromProtobufModels(response.models)),
	})

	useGrpcSubscription({
		key: "mcpButtonClicked",
		debugLabel: "MCP Nav",
		subscribe: UiServiceClient.subscribeToMcpButtonClicked.bind(UiServiceClient),
		request: EMPTY_UI_REQUEST,
		staleAfterMs: null,
		onMessage: () => navigateToMcp(),
	})
	useGrpcSubscription({
		key: "historyButtonClicked",
		debugLabel: "History Nav",
		subscribe: UiServiceClient.subscribeToHistoryButtonClicked.bind(UiServiceClient),
		request: EMPTY_UI_REQUEST,
		staleAfterMs: null,
		onMessage: () => navigateToHistory(),
	})
	useGrpcSubscription({
		key: "chatButtonClicked",
		debugLabel: "Chat Nav",
		subscribe: UiServiceClient.subscribeToChatButtonClicked.bind(UiServiceClient),
		request: EMPTY_UI_REQUEST,
		staleAfterMs: null,
		onMessage: () => navigateToChat(),
	})
	useGrpcSubscription({
		key: "settingsButtonClicked",
		debugLabel: "Settings Nav",
		subscribe: UiServiceClient.subscribeToSettingsButtonClicked.bind(UiServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: null,
		onMessage: () => navigateToSettings(),
	})
	useGrpcSubscription({
		key: "worktreesButtonClicked",
		debugLabel: "Worktrees Nav",
		subscribe: UiServiceClient.subscribeToWorktreesButtonClicked.bind(UiServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: null,
		onMessage: () => navigateToWorktrees(),
	})
	useGrpcSubscription({
		key: "accountButtonClicked",
		debugLabel: "Account Nav",
		subscribe: UiServiceClient.subscribeToAccountButtonClicked.bind(UiServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: null,
		onMessage: () => navigateToAccount(),
	})

	useGrpcSubscription({
		key: "relinquishControl",
		debugLabel: "Relinquish Control",
		subscribe: UiServiceClient.subscribeToRelinquishControl.bind(UiServiceClient),
		request: EMPTY_REQUEST,
		staleAfterMs: null,
		onMessage: () => {
			for (const callback of relinquishControlCallbacks.current) {
				callback()
			}
		},
	})

	useEffect(() => {
		UiServiceClient.initializeWebview(EMPTY_REQUEST).catch((error) => {
			console.error("Failed to initialize webview via gRPC:", error)
		})
		StateServiceClient.getAvailableTerminalProfiles(EMPTY_REQUEST)
			.then((response) => setAvailableTerminalProfiles(response.profiles))
			.catch((error) => console.error("Failed to fetch available terminal profiles:", error))
	}, [setAvailableTerminalProfiles])
}
