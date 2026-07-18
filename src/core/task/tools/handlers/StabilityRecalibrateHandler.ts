import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { Logger } from "@/shared/services/Logger"
import { DietCodeDefaultTool } from "@/shared/tools"
import { orchestrator } from "../../../../infrastructure/ai/Orchestrator"
import { StabilityMonitor } from "../../../integrity/StabilityMonitor"
import type { TaskConfig } from "../types/TaskConfig"
import { declareInternalStateIntent, type IToolHandler, type ToolResponse } from "../types/ToolContracts"

/**
 * StabilityRecalibrateHandler: Handles the 'recalibrate_stability' tool.
 * Allows agents to reset their activity pressure by providing a professional justification.
 */
export class StabilityRecalibrateHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.STABILITY_RECALIBRATE

	getApprovalIntent(block: ToolUse) {
		return declareInternalStateIntent(block, "Reset and persist task stability pressure")
	}

	getDescription(_block: ToolUse): string {
		return `[Stability Recalibration: Cognitive Recovery]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const justification = (block.params as { justification?: string })?.justification || "Routine stabilization."
		const streamId = config.taskId

		if (!streamId) {
			return formatResponse.toolError("Stability Recalibration requires an active execution stream.")
		}

		try {
			Logger.info(
				`[StabilityRecalibration] Agent is performing a Strategic Review in stream ${streamId}. Justification: ${justification}`,
			)

			// V150: Grounded Reset.
			// We create a fresh StabilityMonitor, reset it, and export its state to activity memory.
			const monitor = new StabilityMonitor(config.cwd)
			monitor.resetStabilityPressure()

			const state = monitor.exportState()
			await orchestrator.storeMemory(streamId, "activity_state", JSON.stringify(state))

			// Log specific event for audit forensics
			await orchestrator.storeMemory(streamId, `stability_event_${Date.now()}`, justification)

			return formatResponse.toolResult(
				"🩹 [STABILITY RECALIBRATION] Successful. Activity pressure has been reset to zero.\n" +
					"You may now proceed with standard operations. Maintain architectural integrity in subsequent turns.",
			)
		} catch (error) {
			Logger.error("[StabilityRecalibration] Failed to recalibrate:", error)
			return formatResponse.toolError(`Recalibration failure: ${(error as Error)?.message}`)
		}
	}
}
