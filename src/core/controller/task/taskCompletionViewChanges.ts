import type { IController as Controller } from "@core/controller/types"
import { Empty, Int64Request } from "@shared/proto/dietcode/common"
import { Logger } from "@/shared/services/Logger"

/**
 * Shows task completion changes in a diff view
 * @param controller The controller instance
 * @param request The request containing the timestamp of the message
 * @returns Empty response
 */
export async function taskCompletionViewChanges(controller: Controller, request: Int64Request): Promise<Empty> {
	try {
		if (request.value && controller.task) {
			// presentMultifileDiff is optional on ICheckpointManager, so capture then optionally invoke
			await controller.task.checkpointManager?.presentMultifileDiff?.(request.value, true)
		}
		return Empty.create()
	} catch (error) {
		Logger.error("Error in taskCompletionViewChanges handler:", error)
		throw error
	}
}
