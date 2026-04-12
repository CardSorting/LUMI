import { DietCodeStorageMessage } from "@/shared/messages/content"
import { DietCodeDefaultTool } from "@/shared/tools"
import { convertApplyPatchToolCalls, convertWriteToFileToolCalls } from "./diff-editors"

/**
 * Transforms tool call messages between different tool formats based on native tool support.
 * Converts between apply_patch and write_to_file/replace_in_file formats as needed.
 *
 * @param dietcodeMessages - Array of messages containing tool calls to transform
 * @param nativeTools - Array of tools natively supported by the current provider
 * @returns Transformed messages array, or original if no transformation needed
 */
export function transformToolCallMessages(
	dietcodeMessages: DietCodeStorageMessage[],
	nativeTools?: DietCodeDefaultTool[],
): DietCodeStorageMessage[] {
	// Early return if no messages or native tools provided
	if (!dietcodeMessages?.length || !nativeTools?.length) {
		return dietcodeMessages
	}

	// Create Sets for O(1) lookup performance
	const nativeToolSet = new Set(nativeTools)
	const usedToolSet = new Set<string>()

	// Single pass: collect all tools used in assistant messages
	for (const msg of dietcodeMessages) {
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
		return dietcodeMessages
	}

	// Determine which conversion to apply
	const hasApplyPatchNative = nativeToolSet.has(DietCodeDefaultTool.APPLY_PATCH)
	const hasFileEditNative = nativeToolSet.has(DietCodeDefaultTool.FILE_EDIT) || nativeToolSet.has(DietCodeDefaultTool.FILE_NEW)

	const hasApplyPatchUsed = usedToolSet.has(DietCodeDefaultTool.APPLY_PATCH)
	const hasFileEditUsed = usedToolSet.has(DietCodeDefaultTool.FILE_EDIT) || usedToolSet.has(DietCodeDefaultTool.FILE_NEW)

	// Convert write_to_file/replace_in_file → apply_patch
	if (hasApplyPatchNative && hasFileEditUsed) {
		return convertWriteToFileToolCalls(dietcodeMessages)
	}

	// Convert apply_patch → write_to_file/replace_in_file
	if (hasFileEditNative && hasApplyPatchUsed) {
		return convertApplyPatchToolCalls(dietcodeMessages)
	}

	return dietcodeMessages
}
