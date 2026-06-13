// [LAYER: CORE]
import { ApiConfiguration, ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { DietCodeTool } from "@/shared/tools"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"

/**
 * Shared API handler contract.
 *
 * NOTE: These types intentionally live in their own module (decoupled from
 * `./index`) to break the circular dependency between the provider registry
 * (`index.ts`) and the individual provider implementations. Providers import
 * the contract from here; `index.ts` re-exports it for backward compatibility.
 */

export type CommonApiHandlerOptions = {
	onRetryAttempt?: ApiConfiguration["onRetryAttempt"]
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: DietCodeStorageMessage[],
		tools?: DietCodeTool[],
		useResponseApi?: boolean,
	): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
	abort?(): void
	embedText?(text: string): Promise<number[] | null>
	embedBatch?(texts: string[]): Promise<(number[] | null)[]>
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}
