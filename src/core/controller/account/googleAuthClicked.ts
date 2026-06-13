import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { AuthService } from "@/services/auth/AuthService"

/**
 * Handles the user clicking the Google login link in the UI.
 * Generates a Google OAuth URL and opens it in the external browser.
 *
 * @param controller The controller instance.
 * @returns An empty response.
 */
export async function googleAuthClicked(_controller: Controller, _: EmptyRequest): Promise<Empty> {
	await AuthService.getInstance().createAuthRequest(false, "google")
	return Empty.create()
}
