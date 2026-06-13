import type { IController as Controller } from "@core/controller/types"
import type { StringRequest } from "@shared/proto/dietcode/common"
import { Empty } from "@shared/proto/dietcode/common"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"

/**
 * Records that a prompt suggestion was clicked
 * @param controller The controller instance
 * @param request The suggestion text that was clicked
 * @returns Empty response
 */
export async function onSuggestionClicked(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const ulid = controller.task?.ulid || "unknown"
		telemetryService.captureSuggestionClicked(ulid, request.value)
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to record suggestion click: ${error}`)
		throw error
	}
}
