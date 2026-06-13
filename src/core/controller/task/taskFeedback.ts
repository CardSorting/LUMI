import type { IController as Controller } from "@core/controller/types"
import { Empty, StringRequest } from "@shared/proto/dietcode/common"
import type { TaskFeedbackType } from "@shared/WebviewMessage"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"

/**
 * Handles task feedback submission (thumbs up/down)
 * @param controller The controller instance
 * @param request The StringRequest containing the feedback type ("thumbs_up" or "thumbs_down") in the value field
 * @returns Empty response
 */
export async function taskFeedback(controller: Controller, request: StringRequest): Promise<Empty> {
	if (!request.value) {
		Logger.warn("taskFeedback: Missing feedback type value")
		return Empty.create()
	}

	try {
		if (controller.task?.ulid) {
			telemetryService.captureTaskFeedback(controller.task.ulid, request.value as TaskFeedbackType)
		} else {
			Logger.warn("taskFeedback: No active task to receive feedback")
		}
	} catch (error) {
		Logger.error("Error in taskFeedback handler:", error)
	}

	return Empty.create()
}
