import { Anthropic } from "@anthropic-ai/sdk"
import { DietCodeMessageMetricsInfo, DietCodeMessageModelInfo } from "./metrics"

export type DietCodePromptInputContent = string

export type DietCodeMessageRole = "user" | "assistant"

export interface DietCodeReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface DietCodeSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export const REASONING_DETAILS_PROVIDERS = ["dietcode", "openrouter"]

/**
 * An extension of Anthropic.MessageParam that includes DietCode-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with additional
 * fields unknown to Anthropic SDK.
 */
export interface DietCodeTextContentBlock extends Anthropic.TextBlockParam, DietCodeSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: DietCodeReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface DietCodeImageContentBlock extends Anthropic.ImageBlockParam, DietCodeSharedMessageParam {}

export interface DietCodeDocumentContentBlock extends Anthropic.DocumentBlockParam, DietCodeSharedMessageParam {}

export interface DietCodeUserToolResultContentBlock extends Anthropic.ToolResultBlockParam, DietCodeSharedMessageParam {}

/**
 * Assistant only content types
 */
export interface DietCodeAssistantToolUseBlock extends Anthropic.ToolUseBlockParam, DietCodeSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: unknown[] | DietCodeReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface DietCodeAssistantThinkingBlock extends Anthropic.ThinkingBlock, DietCodeSharedMessageParam {
	// The summary items returned by OpenAI response API
	// The reasoning details that will be moved to the text block when finalized
	summary?: unknown[] | DietCodeReasoningDetailParam[]
}

export interface DietCodeAssistantRedactedThinkingBlock
	extends Anthropic.RedactedThinkingBlockParam,
		DietCodeSharedMessageParam {}

export type DietCodeToolResponseContent = DietCodePromptInputContent | Array<DietCodeTextContentBlock | DietCodeImageContentBlock>

export type DietCodeUserContent =
	| DietCodeTextContentBlock
	| DietCodeImageContentBlock
	| DietCodeDocumentContentBlock
	| DietCodeUserToolResultContentBlock

export type DietCodeAssistantContent =
	| DietCodeTextContentBlock
	| DietCodeImageContentBlock
	| DietCodeDocumentContentBlock
	| DietCodeAssistantToolUseBlock
	| DietCodeAssistantThinkingBlock
	| DietCodeAssistantRedactedThinkingBlock

export type DietCodeContent = DietCodeUserContent | DietCodeAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes DietCode-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to DietCode to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface DietCodeStorageMessage extends Anthropic.MessageParam {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: DietCodeMessageRole
	content: DietCodePromptInputContent | DietCodeContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: DietCodeMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: DietCodeMessageMetricsInfo
	/**
	 * Timestamp of when the message was created
	 */
	ts?: number
}

/**
 * Converts DietCodeStorageMessage to Anthropic.MessageParam by removing DietCode-specific fields
 * DietCode-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertDietCodeStorageToAnthropicMessage(
	dietcodeMessage: DietCodeStorageMessage,
	provider = "anthropic",
): Anthropic.MessageParam {
	const { role, content } = dietcodeMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip DietCode-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent
		? filteredContent.map(cleanContentBlock)
		: (filteredContent as Anthropic.MessageParam["content"])

	return { role, content: cleanedContent }
}

/**
 * Clean a content block by removing DietCode-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: DietCodeContent): Anthropic.ContentBlock {
	// Fast path: if no DietCode-specific fields exist, return as-is
	const hasDietCodeFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasDietCodeFields) {
		return block as Anthropic.ContentBlock
	}

	// Removes DietCode-specific fields & the signature field that's added for Gemini.
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest satisfies Anthropic.ContentBlock
}
