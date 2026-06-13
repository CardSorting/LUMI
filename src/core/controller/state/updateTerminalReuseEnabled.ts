import type { IController as Controller } from "@core/controller/types"
import * as proto from "@/shared/proto"

export async function updateTerminalReuseEnabled(
	controller: Controller,
	request: proto.dietcode.BooleanRequest,
): Promise<proto.dietcode.Empty> {
	const enabled = request.value

	// Update the terminal reuse setting in the state
	controller.stateManager.setGlobalState("terminalReuseEnabled", enabled)

	// Broadcast state update to all webviews
	await controller.postStateToWebview()

	return proto.dietcode.Empty.create({})
}
