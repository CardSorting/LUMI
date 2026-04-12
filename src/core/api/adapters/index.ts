import { CodemarieStorageMessage } from "@/shared/messages/content"
import { CodemarieDefaultTool } from "@/shared/tools"
import { convertApplyPatchToolCalls, convertWriteToFileToolCalls } from "./diff-editors"

/**
 * Transforms tool call messages between different tool formats based on native tool support.
 * Converts between apply_patch and write_to_file/replace_in_file formats as needed.
 *
 * @param codemarieMessages - Array of messages containing tool calls to transform
 * @param nativeTools - Array of tools natively supported by the current provider
 * @returns Transformed messages array, or original if no transformation needed
 */
export function transformToolCallMessages(
	codemarieMessages: CodemarieStorageMessage[],
	nativeTools?: CodemarieDefaultTool[],
): CodemarieStorageMessage[] {
	// Early return if no messages or native tools provided
	if (!codemarieMessages?.length || !nativeTools?.length) {
		return codemarieMessages
	}

	// Create Sets for O(1) lookup performance
	const nativeToolSet = new Set(nativeTools)
	const usedToolSet = new Set<string>()

	// Single pass: collect all tools used in assistant messages
	for (const msg of codemarieMessages) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use" && block.name) {
					usedToolSet.add(block.name)
				}
			}
		}
	}

	// Early return if no tools were used
	if (usedToolSet.size === 0) {
		return codemarieMessages
	}

	// Determine which conversion to apply
	const hasApplyPatchNative = nativeToolSet.has(CodemarieDefaultTool.APPLY_PATCH)
	const hasFileEditNative =
		nativeToolSet.has(CodemarieDefaultTool.FILE_EDIT) || nativeToolSet.has(CodemarieDefaultTool.FILE_NEW)

	const hasApplyPatchUsed = usedToolSet.has(CodemarieDefaultTool.APPLY_PATCH)
	const hasFileEditUsed = usedToolSet.has(CodemarieDefaultTool.FILE_EDIT) || usedToolSet.has(CodemarieDefaultTool.FILE_NEW)

	// Convert write_to_file/replace_in_file → apply_patch
	if (hasApplyPatchNative && hasFileEditUsed) {
		return convertWriteToFileToolCalls(codemarieMessages)
	}

	// Convert apply_patch → write_to_file/replace_in_file
	if (hasFileEditNative && hasApplyPatchUsed) {
		return convertApplyPatchToolCalls(codemarieMessages)
	}

	return codemarieMessages
}
