import { Anthropic } from "@anthropic-ai/sdk"
import { CodemarieMessageMetricsInfo, CodemarieMessageModelInfo } from "./metrics"

export type CodemariePromptInputContent = string

export type CodemarieMessageRole = "user" | "assistant"

export interface CodemarieReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface CodemarieSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export const REASONING_DETAILS_PROVIDERS = ["codemarie", "openrouter"]

/**
 * An extension of Anthropic.MessageParam that includes Codemarie-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with additional
 * fields unknown to Anthropic SDK.
 */
export interface CodemarieTextContentBlock extends Anthropic.TextBlockParam, CodemarieSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: CodemarieReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface CodemarieImageContentBlock extends Anthropic.ImageBlockParam, CodemarieSharedMessageParam {}

export interface CodemarieDocumentContentBlock extends Anthropic.DocumentBlockParam, CodemarieSharedMessageParam {}

export interface CodemarieUserToolResultContentBlock extends Anthropic.ToolResultBlockParam, CodemarieSharedMessageParam {}

/**
 * Assistant only content types
 */
export interface CodemarieAssistantToolUseBlock extends Anthropic.ToolUseBlockParam, CodemarieSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: unknown[] | CodemarieReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface CodemarieAssistantThinkingBlock extends Anthropic.ThinkingBlock, CodemarieSharedMessageParam {
	// The summary items returned by OpenAI response API
	// The reasoning details that will be moved to the text block when finalized
	summary?: unknown[] | CodemarieReasoningDetailParam[]
}

export interface CodemarieAssistantRedactedThinkingBlock
	extends Anthropic.RedactedThinkingBlockParam,
		CodemarieSharedMessageParam {}

export type CodemarieToolResponseContent =
	| CodemariePromptInputContent
	| Array<CodemarieTextContentBlock | CodemarieImageContentBlock>

export type CodemarieUserContent =
	| CodemarieTextContentBlock
	| CodemarieImageContentBlock
	| CodemarieDocumentContentBlock
	| CodemarieUserToolResultContentBlock

export type CodemarieAssistantContent =
	| CodemarieTextContentBlock
	| CodemarieImageContentBlock
	| CodemarieDocumentContentBlock
	| CodemarieAssistantToolUseBlock
	| CodemarieAssistantThinkingBlock
	| CodemarieAssistantRedactedThinkingBlock

export type CodemarieContent = CodemarieUserContent | CodemarieAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes Codemarie-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to Codemarie to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface CodemarieStorageMessage extends Anthropic.MessageParam {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: CodemarieMessageRole
	content: CodemariePromptInputContent | CodemarieContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: CodemarieMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: CodemarieMessageMetricsInfo
	/**
	 * Timestamp of when the message was created
	 */
	ts?: number
}

/**
 * Converts CodemarieStorageMessage to Anthropic.MessageParam by removing Codemarie-specific fields
 * Codemarie-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertCodemarieStorageToAnthropicMessage(
	codemarieMessage: CodemarieStorageMessage,
	provider = "anthropic",
): Anthropic.MessageParam {
	const { role, content } = codemarieMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip Codemarie-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent
		? filteredContent.map(cleanContentBlock)
		: (filteredContent as Anthropic.MessageParam["content"])

	return { role, content: cleanedContent }
}

/**
 * Clean a content block by removing Codemarie-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: CodemarieContent): Anthropic.ContentBlock {
	// Fast path: if no Codemarie-specific fields exist, return as-is
	const hasCodemarieFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasCodemarieFields) {
		return block as Anthropic.ContentBlock
	}

	// Removes Codemarie-specific fields & the signature field that's added for Gemini.
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest satisfies Anthropic.ContentBlock
}
