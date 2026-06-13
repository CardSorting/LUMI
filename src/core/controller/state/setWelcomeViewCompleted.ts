import type { IController as Controller } from "@core/controller/types"
import type { BooleanRequest } from "@shared/proto/dietcode/common"
import { Empty } from "@shared/proto/dietcode/common"
import { Logger } from "@/shared/services/Logger"

/**
 * Sets the welcomeViewCompleted flag to the specified boolean value
 * @param controller The controller instance
 * @param request The boolean request containing the value to set
 * @returns Empty response
 */
export async function setWelcomeViewCompleted(controller: Controller, request: BooleanRequest): Promise<Empty> {
	try {
		// Update the global state to set welcomeViewCompleted to the requested value
		controller.stateManager.setGlobalState("welcomeViewCompleted", request.value)

		await controller.postStateToWebview()

		Logger.log(`Welcome view completed set to: ${request.value}`)
		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to set welcome view completed:", error)
		throw error
	}
}
