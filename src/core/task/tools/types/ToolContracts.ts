// [LAYER: CORE]
import type { ToolUse } from "@core/assistant-message"
import type { DietCodeToolResponseContent } from "@/shared/messages"
import { DietCodeDefaultTool } from "@/shared/tools"
import type { TaskConfig } from "./TaskConfig"
import type { StronglyTypedUIHelpers } from "./UIHelpers"

/**
 * Tool handler contracts.
 *
 * NOTE: These interfaces intentionally live in their own leaf module (decoupled
 * from `../ToolExecutorCoordinator` and `../../index`) to break the circular
 * dependency between the coordinator/registry and the individual tool handlers.
 * Handlers import the contract from here; the coordinator re-exports it for
 * backward compatibility. This mirrors the Dependency Inversion Principle:
 * shared contracts belong in a leaf, never in the composition root.
 */

/**
 * Canonical tool response payload. Re-exported from the shared message domain
 * so handlers don't need to depend on the heavyweight `task/index.ts` barrel.
 */
export type ToolResponse = DietCodeToolResponseContent

export interface IToolHandler {
	readonly name: DietCodeDefaultTool
	execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
	getDescription(block: ToolUse): string
}

export interface IPartialBlockHandler {
	handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void>
}

export interface IFullyManagedTool extends IToolHandler, IPartialBlockHandler {
	// Marker interface for tools that handle their own complete approval flow
}

/**
 * A wrapper class that allows a single tool handler to be registered under
 * multiple names. This provides proper typing for tools that share the same
 * implementation logic.
 */
export class SharedToolHandler implements IFullyManagedTool {
	constructor(
		public readonly name: DietCodeDefaultTool,
		private baseHandler: IFullyManagedTool,
	) {}

	getDescription(block: ToolUse): string {
		return this.baseHandler.getDescription(block)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		return this.baseHandler.execute(config, block)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return this.baseHandler.handlePartialBlock(block, uiHelpers)
	}
}
