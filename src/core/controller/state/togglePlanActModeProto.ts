import type { IController as Controller } from "@core/controller/types"
import { Boolean } from "@shared/proto/dietcode/common"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/dietcode/state"
import { Mode } from "@shared/storage/types"
import { Logger } from "@/shared/services/Logger"

/**
 * Updates plan/act mode for settings or legacy RPC callers.
 * Delegates to switchAgentMode — does not cancel active tasks.
 */
export async function togglePlanActModeProto(controller: Controller, request: TogglePlanActModeRequest): Promise<Boolean> {
	try {
		let mode: Mode
		if (request.mode === PlanActMode.PLAN) {
			mode = "plan"
		} else if (request.mode === PlanActMode.ACT) {
			mode = "act"
		} else {
			throw new Error(`Invalid mode value: ${request.mode}`)
		}
		const chatContent = request.chatContent

		// Call the existing controller implementation
		const sentMessage = await controller.togglePlanActMode(mode, chatContent)

		return Boolean.create({
			value: sentMessage,
		})
	} catch (error) {
		Logger.error("Failed to toggle Plan/Act mode:", error)
		throw error
	}
}
