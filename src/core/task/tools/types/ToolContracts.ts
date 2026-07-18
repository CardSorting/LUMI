// [LAYER: CORE]
import type { ToolUse } from "@core/assistant-message"
import type { ApprovalIntent, ApprovalRequirement, ExecutionAuditValue } from "@shared/execution/executionFunnelEvent"
import type { DietCodeToolResponseContent } from "@/shared/messages"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "./TaskConfig"
import type { StronglyTypedUIHelpers } from "./UIHelpers"

/**
 * Tool handler contracts.
 *
 * These interfaces intentionally live in a leaf module so the registry and
 * handlers depend on one modern contract without a coordinator-owned shim.
 */

/**
 * Canonical tool response payload. Re-exported from the shared message domain
 * so handlers don't need to depend on the heavyweight `task/index.ts` barrel.
 */
export type ToolResponse = DietCodeToolResponseContent

export interface IToolHandler {
	readonly name: DietCodeDefaultTool
	/** Pure consent declaration. ExecutionFunnel is the only decision-maker. */
	getApprovalIntent(block: ToolUse): ApprovalIntent
	execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse | { kind: "continuation"; continuation: any }>
	getDescription(block: ToolUse): string
}

export interface IPartialBlockHandler {
	handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void>
}

/** Convenience builder for handlers declaring consent needs without deciding them. */
export function declareApprovalIntent(
	block: ToolUse,
	options: {
		description: string
		requirements: ApprovalRequirement[]
		promptType?: string
		promptMessage?: string
		notification?: string
		normalizedArguments?: Record<string, ExecutionAuditValue>
	},
): ApprovalIntent {
	const normalizedArguments: Record<string, ExecutionAuditValue> = options.normalizedArguments ?? {}
	if (!options.normalizedArguments) {
		for (const [key, value] of Object.entries(block.params)) if (typeof value === "string") normalizedArguments[key] = value
	}
	return {
		description: options.description,
		normalizedArguments,
		requirements: options.requirements,
		prompt: {
			type: options.promptType ?? "tool",
			message: options.promptMessage ?? JSON.stringify({ tool: block.name, ...normalizedArguments }),
			notification: options.notification,
		},
	}
}

/** Pure declaration for operations that do not require consent. */
export function declareNoConsentIntent(block: ToolUse, description: string): ApprovalIntent {
	return declareApprovalIntent(block, { description, requirements: [] })
}

/** Pure declaration for durable internal-state mutations not covered by auto-approval settings. */
export function declareInternalStateIntent(
	block: ToolUse,
	description: string,
	prompt?: { type: string; message: string; notification?: string },
): ApprovalIntent {
	return declareApprovalIntent(block, {
		description,
		requirements: [
			{
				capability: "internal_state",
				risk: "elevated",
				requestedSideEffects: ["mutate durable internal state"],
				autoApprovalEligible: false,
			},
		],
		promptType: prompt?.type,
		promptMessage: prompt?.message,
		notification: prompt?.notification,
	})
}

/**
 * A wrapper class that allows a single tool handler to be registered under
 * multiple names. This provides proper typing for tools that share the same
 * implementation logic.
 */
export class SharedToolHandler implements IToolHandler, IPartialBlockHandler {
	constructor(
		public readonly name: DietCodeDefaultTool,
		private baseHandler: IToolHandler & IPartialBlockHandler,
	) {}

	getApprovalIntent(block: ToolUse): ApprovalIntent {
		return this.baseHandler.getApprovalIntent(block)
	}

	getDescription(block: ToolUse): string {
		return this.baseHandler.getDescription(block)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse | { kind: "continuation"; continuation: any }> {
		return this.baseHandler.execute(config, block)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return this.baseHandler.handlePartialBlock(block, uiHelpers)
	}
}
