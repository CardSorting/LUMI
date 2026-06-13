import type { IController as Controller } from "@core/controller/types"
import type { EmptyRequest } from "@shared/proto/dietcode/common"
import { Empty } from "@shared/proto/dietcode/common"

/**
 * Handles the account logout action
 * @param controller The controller instance
 * @param _request The empty request object
 * @returns Empty response
 */
export async function ocaAccountLogoutClicked(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.handleOcaSignOut()
	return Empty.create({})
}
