import type { IController as Controller } from "@core/controller/types"
import { Empty, EmptyRequest } from "@shared/proto/dietcode/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { xaiOAuthManager } from "@/integrations/xai-oauth/oauth"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"

export async function xaiOauthSignIn(controller: Controller, _: EmptyRequest): Promise<Empty> {
	try {
		const authorization = await xaiOAuthManager.startAuthorizationFlow()
		authorization.completion
			.then(async () => {
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Successfully signed in to xAI Grok",
				})
				await controller.postStateToWebview()
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error)
				Logger.error("[xaiOauthSignIn] Device authorization failed:", error)
				if (!/cancelled|timed out/i.test(message)) {
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `xAI sign in failed: ${message}`,
					})
				}
			})

		await openExternal(authorization.verificationUrl)
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Complete xAI sign in in your browser${authorization.userCode ? ` using code ${authorization.userCode}` : ""}.`,
		})
	} catch (error) {
		Logger.error("[xaiOauthSignIn] Failed to start OAuth flow:", error)
		xaiOAuthManager.cancelAuthorizationFlow()
		throw error
	}
	return {}
}
