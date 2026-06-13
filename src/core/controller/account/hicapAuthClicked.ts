import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"

/**
 * Initiates Hicap auth
 */
export async function hicapAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	const callbackUrl = await HostProvider.get().getCallbackUrl("/hicap")
	const authUrl = new URL("https://dashboard.hicap.ai/setup")
	authUrl.searchParams.set("application", "dietcode")
	authUrl.searchParams.set("callback_url", callbackUrl)

	await openExternal(authUrl.toString())

	return {}
}
