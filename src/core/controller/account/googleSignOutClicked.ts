import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { AuthService } from "@/services/auth/AuthService"

/**
 * Handles the user clicking the Google logout link in the UI.
 * Clears Google-specific authentication tokens and updates state.
 *
 * @param _controller The controller instance.
 * @returns An empty response.
 */
export async function googleSignOutClicked(_controller: Controller, _: EmptyRequest): Promise<Empty> {
	await AuthService.getInstance().signOutProvider("google")
	return Empty.create()
}
