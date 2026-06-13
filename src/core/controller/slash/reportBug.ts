import type { IController as Controller } from "@core/controller/types"
import { Empty, StringRequest } from "@shared/proto/dietcode/common"

/**
 * Report bug slash command logic
 */
export async function reportBug(controller: Controller, _request: StringRequest): Promise<Empty> {
	await controller.task?.handleWebviewAskResponse("yesButtonClicked")
	return Empty.create()
}
