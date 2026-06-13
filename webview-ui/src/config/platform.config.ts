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
}

function stringToPlatformType(name: string): PlatformType {
	const mapping: Record<string, PlatformType> = {
		vscode: PlatformType.VSCODE,
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
	postMessageHandler: "vscode"
	togglePlanActKeys: string
	supportsTerminalMentions: boolean
}

type PlatformConfigs = Record<string, PlatformConfigJson>

// Global type declarations for postMessage and vscode API
declare global {
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
