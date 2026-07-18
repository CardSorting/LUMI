import type { DietCodeAsk, DietCodeSay, TaskAuditMetadata } from "@shared/ExtensionMessage"
import type { DietCodeAskResponse } from "@shared/WebviewMessage"
import type { ToolParamName, ToolUse } from "../../../assistant-message"
import { removeClosingTag } from "../utils/ToolConstants"
import type { TaskConfig } from "./TaskConfig"

/**
 * Strongly-typed UI helper functions for tool handlers
 */
export interface StronglyTypedUIHelpers {
	// Core UI methods
	say: (
		type: DietCodeSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
		auditMetadata?: TaskAuditMetadata,
	) => Promise<number | undefined>

	ask: (
		type: DietCodeAsk,
		text?: string,
		partial?: boolean,
	) => Promise<{
		response: DietCodeAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>

	// Utility methods
	removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => string
	removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: DietCodeAsk | DietCodeSay) => Promise<void>

	// Config access - returns the proper typed config
	getConfig: () => TaskConfig
}

/**
 * Creates strongly-typed UI helpers from a TaskConfig
 */
export function createUIHelpers(config: TaskConfig): StronglyTypedUIHelpers {
	return {
		say: config.callbacks.say,
		ask: config.callbacks.ask,
		removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => removeClosingTag(block, tag, text),
		removeLastPartialMessageIfExistsWithType: config.callbacks.removeLastPartialMessageIfExistsWithType,
		getConfig: () => config,
	}
}
