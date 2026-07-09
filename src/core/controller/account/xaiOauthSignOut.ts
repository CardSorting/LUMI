import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { xaiOAuthManager } from "@/integrations/xai-oauth/oauth"
import { Logger } from "@/shared/services/Logger"

export async function xaiOauthSignOut(controller: Controller, _: EmptyRequest): Promise<Empty> {
	try {
		xaiOAuthManager.cancelAuthorizationFlow()
		await xaiOAuthManager.clearCredentials()
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("[xaiOauthSignOut] Failed to sign out:", error)
		throw error
	}
	return {}
}
