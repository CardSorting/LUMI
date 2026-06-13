import type { IController as Controller } from "@core/controller/types"
import { EmptyRequest, String as ProtoString } from "@shared/proto/dietcode/common"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"

/**
 * Handles the user clicking the login link in the UI.
 * Generates a secure nonce for state validation, stores it in secrets,
 * and opens the authentication URL in the external browser.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function ocaAccountLoginClicked(_controller: Controller, _: EmptyRequest): Promise<ProtoString> {
	return await OcaAuthService.getInstance().createAuthRequest()
}
