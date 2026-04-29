import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { Logger } from "@/shared/services/Logger"
import { DietCodeDefaultTool } from "@/shared/tools"
import { orchestrator } from "../../../../infrastructure/ai/Orchestrator"
import { MetabolicMonitor } from "../../../integrity/MetabolicMonitor"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * SovereignBreathHandler: Handles the 'sovereign_breath' tool.
 * Allows agents to reset their metabolic pressure by providing a high-fidelity justification.
 */
export class SovereignBreathHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.SOVEREIGN_BREATH

	getDescription(_block: ToolUse): string {
		return `[Sovereign Breath: Cognitive Recalibration]`
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
			const monitor = new MetabolicMonitor(config.cwd)
			monitor.resetMetabolicPressure()

			const state = monitor.exportState()
			await orchestrator.storeMemory(streamId, "activity_state", JSON.stringify(state))

			// Log specific event for audit forensics
			await orchestrator.storeMemory(streamId, `stability_event_${Date.now()}`, justification)

			return formatResponse.toolResult(
				"🌬️ [STABILITY RECALIBRATION] Successful. Activity pressure has been reset to zero.\n" +
					"You may now proceed with standard operations. Maintain architectural integrity in subsequent turns.",
			)
		} catch (error) {
			Logger.error("[SovereignBreath] Failed to execute breath:", error)
			return formatResponse.toolError(`Breath failure: ${(error as Error)?.message}`)
		}
	}
}
