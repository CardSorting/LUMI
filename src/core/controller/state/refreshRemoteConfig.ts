import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { fetchRemoteConfig } from "@/core/storage/remote-config/fetch"

/**
 * fetches the remote config
 * @param controller The controller instance
 * @param request Empty request
 * @returns Empty response
 */
export async function refreshRemoteConfig(controller: Controller, _: EmptyRequest): Promise<Empty> {
	await fetchRemoteConfig(controller)

	return Empty.create()
}
