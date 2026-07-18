import type { IController as Controller } from "@core/controller/types"
import { Empty } from "@shared/proto/dietcode/common"
import { ResetStateRequest } from "@shared/proto/dietcode/state"
import { resetGlobalState, resetWorkspaceState } from "@/core/storage/utils/state-helpers"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Resets the extension state to its defaults
 * @param controller The controller instance
 * @param request The reset state request containing the global flag
 * @returns An empty response
 */
export async function resetState(controller: Controller, request: ResetStateRequest): Promise<Empty> {
	try {
		if (request.global) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Resetting global state...",
			})
			await resetGlobalState()
		} else {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Resetting workspace state...",
			})
			await resetWorkspaceState()
		}

		if (controller.task) {
			await controller.clearTask()
		}

		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "State reset",
		})
		await controller.postStateToWebview()

		await sendChatButtonClickedEvent()

		return Empty.create()
	} catch (error) {
		Logger.error("Error resetting state:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Failed to reset state: ${error instanceof Error ? error.message : String(error)}`,
		})
		throw error
	}
}
