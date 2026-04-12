import platformConfigs from "./platform-configs.json"

export interface PlatformConfig {
	type: PlatformType
	messageEncoding: MessageEncoding
	showNavbar: boolean
	postMessage: PostMessageFunction
	encodeMessage: MessageEncoder
	decodeMessage: MessageDecoder
	togglePlanActKeys: string
	supportsTerminalMentions: boolean
}

export enum PlatformType {
	VSCODE = 0,
	STANDALONE = 1,
	REMOTE = 2,
}

function stringToPlatformType(name: string): PlatformType {
	const mapping: Record<string, PlatformType> = {
		vscode: PlatformType.VSCODE,
		standalone: PlatformType.STANDALONE,
		remote: PlatformType.REMOTE,
	}
	if (name in mapping) {
		return mapping[name]
	}
	console.error("Unknown platform:", name)
	// Default to VSCode for unknown types
	return PlatformType.VSCODE
}

// Internal type for JSON structure (not exported)
type PlatformConfigJson = {
	messageEncoding: "none" | "json"
	showNavbar: boolean
	postMessageHandler: "vscode" | "standalone"
	togglePlanActKeys: string
	supportsTerminalMentions: boolean
}

type PlatformConfigs = Record<string, PlatformConfigJson>

// Global type declarations for postMessage and vscode API
declare global {
	interface Window {
		// This is the post message handler injected by JetBrains.
		// !! Do not change the name of the handler without updating it on
		// the JetBrains side as well. !!
		standalonePostMessage?: (message: string) => void
		remoteSocket?: WebSocket
	}
	interface VsCodeApi {
		postMessage(message: unknown): void
		getState(): unknown
		setState(state: unknown): void
	}
	function acquireVsCodeApi(): VsCodeApi
}

// Initialize the vscode API if available
const vsCodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null

// Implementations for post message handling
const postMessageStrategies: Record<string, PostMessageFunction> = {
	vscode: (message: unknown) => {
		if (vsCodeApi) {
			vsCodeApi.postMessage(message)
		} else {
			console.log("postMessage fallback: ", message)
		}
	},
	standalone: (message: unknown) => {
		const standalonePostMessage = window.standalonePostMessage
		if (!standalonePostMessage) {
			console.error("Standalone postMessage not found.")
			return
		}
		const json = JSON.stringify(message)
		console.log(`Standalone postMessage: ${json.slice(0, 200)}`)
		standalonePostMessage(json)
	},
	remote: (message: unknown) => {
		const remoteSocket = window.remoteSocket
		if (!remoteSocket || remoteSocket.readyState !== WebSocket.OPEN) {
			console.warn("Remote socket not connected. Queuing message not implemented here yet.")
			return
		}
		const json = JSON.stringify(message)
		remoteSocket.send(json)
	},
}

// Implementations for message encoding
const messageEncoders: Record<string, MessageEncoder> = {
	none: <T>(message: T, _encoder: (_: T) => unknown) => message as unknown,
	json: <T>(message: T, encoder: (_: T) => unknown) => encoder(message),
}

// Implementations for message decoding
const messageDecoders: Record<string, MessageDecoder> = {
	none: <T>(message: unknown, _decoder: (_: Record<string, unknown>) => T) => message as T,
	json: <T>(message: unknown, decoder: (_: Record<string, unknown>) => T) => decoder(message as Record<string, unknown>),
}

// Local declaration of the platform compile-time constant
declare const __PLATFORM__: string

// Get the specific platform config at compile time
const configs = platformConfigs as PlatformConfigs
const selectedConfig = configs[__PLATFORM__]
console.log("[PLATFORM_CONFIG] Build platform:", __PLATFORM__)

// Build the platform config with injected functions
// Callers should use this in the situations where the react component is not available.
export const PLATFORM_CONFIG: PlatformConfig = {
	type: stringToPlatformType(__PLATFORM__),
	messageEncoding: selectedConfig.messageEncoding,
	showNavbar: selectedConfig.showNavbar,
	postMessage: postMessageStrategies[selectedConfig.postMessageHandler],
	encodeMessage: messageEncoders[selectedConfig.messageEncoding],
	decodeMessage: messageDecoders[selectedConfig.messageEncoding],
	togglePlanActKeys: selectedConfig.togglePlanActKeys,
	supportsTerminalMentions: selectedConfig.supportsTerminalMentions,
}

type MessageEncoding = "none" | "json"

// Function types for platform-specific behaviors
type PostMessageFunction = (message: unknown) => void
type MessageEncoder = <T>(message: T, encoder: (_: T) => unknown) => unknown
type MessageDecoder = <T>(message: unknown, decoder: (_: Record<string, unknown>) => T) => T
