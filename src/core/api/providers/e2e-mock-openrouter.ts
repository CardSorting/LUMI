import { ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { DietCodeStorageMessage } from "@/shared/messages/content"
import { DietCodeTool } from "@/shared/tools"
import { resolveE2EMockResponse } from "../e2e-fixtures"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ApiHandler, ApiHandlerModel, CommonApiHandlerOptions } from "../types"

interface E2EMockOpenRouterHandlerOptions extends CommonApiHandlerOptions {
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
}

/**
 * In-process OpenRouter stand-in for E2E. Avoids HTTP to localhost:7777, which can fail
 * inside the VS Code extension host (connection errors) even when the Playwright mock server is up.
 */
export class E2EMockOpenRouterHandler implements ApiHandler {
	lastGenerationId?: string

	constructor(private readonly options: E2EMockOpenRouterHandlerOptions) {}

	async *createMessage(_systemPrompt: string, messages: DietCodeStorageMessage[], _tools?: DietCodeTool[]): ApiStream {
		const responseText = resolveE2EMockResponse(messages)
		this.lastGenerationId = `e2e_gen_${Date.now()}`

		yield { type: "text", text: responseText, id: this.lastGenerationId }

		yield {
			type: "usage",
			inputTokens: 140,
			outputTokens: responseText.length,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: (140 + responseText.length) * 0.00015,
			id: this.lastGenerationId,
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		return {
			type: "usage",
			inputTokens: 140,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
		}
	}

	getModel(): ApiHandlerModel {
		const modelId = this.options.openRouterModelId || openRouterDefaultModelId
		return {
			id: modelId,
			info: this.options.openRouterModelInfo || openRouterDefaultModelInfo,
		}
	}
}
