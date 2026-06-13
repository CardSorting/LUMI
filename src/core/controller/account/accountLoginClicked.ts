import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest, String } from "@shared/proto/dietcode/common"
import { AuthService } from "@/services/auth/AuthService"

/**
 * Handles the user clicking the login link in the UI.
 * Generates a secure nonce for state validation, stores it in secrets,
 * and opens the authentication URL in the external browser.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function accountLoginClicked(_controller: Controller, _: EmptyRequest): Promise<String> {
	return await AuthService.getInstance().createAuthRequest()
}
