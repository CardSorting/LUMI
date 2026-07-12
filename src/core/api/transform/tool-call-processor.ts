import type {
	ChatCompletionChunk,
	ChatCompletionToolChoiceOption,
	ChatCompletionTool as OpenAITool,
} from "openai/resources/chat/completions"
import { Logger } from "@/shared/services/Logger"
import type { ApiStreamToolCallsChunk } from "./stream"

/**
 * Helper class to process tool call deltas from OpenAI-compatible streaming responses.
 * Handles accumulating tool call ID and name across multiple delta chunks,
 * and yields properly formatted tool call chunks when arguments are received.
 */
export class ToolCallProcessor {
	private toolCallsByIndex: Map<number, { id: string; name: string }>

	constructor() {
		this.toolCallsByIndex = new Map()
	}

	/**
	 * Process tool call deltas from a chunk and yield formatted tool call chunks.
	 * @param toolCallDeltas - Array of tool call deltas from the chunk
	 * @yields Formatted tool call chunks ready to be yielded in the API stream
	 */
	*processToolCallDeltas(
		toolCallDeltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
	): Generator<ApiStreamToolCallsChunk> {
		if (!toolCallDeltas) {
			return
		}

		for (const toolCallDelta of toolCallDeltas) {
			const index = toolCallDelta.index ?? 0
			const state = this.toolCallsByIndex.get(index) ?? { id: "", name: "" }
			// Accumulate the tool call ID if present
			if (toolCallDelta.id) {
				state.id = toolCallDelta.id
			}

			// Accumulate the function name if present
			if (toolCallDelta.function?.name) {
				Logger.debug(`[ToolCallProcessor] Native Tool Called: ${toolCallDelta.function.name}`)
				state.name = toolCallDelta.function.name
			}
			this.toolCallsByIndex.set(index, state)

			// Only yield when we have all required fields: id, name, and arguments
			if (state.id && state.name && toolCallDelta.function?.arguments) {
				yield {
					type: "tool_calls",
					tool_call: {
						...toolCallDelta,
						call_id: state.id,
						function: {
							...toolCallDelta.function,
							id: state.id,
							name: state.name,
						},
					},
				}
			}
		}
	}

	/**
	 * Reset the internal state. Call this when starting a new message.
	 */
	reset(): void {
		this.toolCallsByIndex.clear()
	}

	/**
	 * Get the current accumulated tool call state (useful for debugging).
	 */
	getState(index = 0): { id: string; name: string } {
		return { ...(this.toolCallsByIndex.get(index) ?? { id: "", name: "" }) }
	}
}

export function getOpenAIToolParams(tools?: OpenAITool[], enableParallelToolCalls = false) {
	return tools?.length
		? {
				tools,
				tool_choice: tools ? ("auto" as ChatCompletionToolChoiceOption) : undefined,
				parallel_tool_calls: !!enableParallelToolCalls,
			}
		: {
				tools: undefined,
			}
}
