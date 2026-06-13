import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"

export async function cancelBackgroundCommand(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const controllerWithCancel = controller as Controller & {
		cancelBackgroundCommand: () => Promise<void>
	}
	await controllerWithCancel.cancelBackgroundCommand()
	return Empty.create()
}
